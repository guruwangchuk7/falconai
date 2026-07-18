# LiveKit-Based Meeting Ingestion ("Falcon Meet") — Design

**Status:** Approved
**Date:** 2026-07-16

## Context

The first sub-project (`docs/superpowers/specs/2026-07-15-meeting-ingestion-transcription-pipeline-design.md`)
built a real-time transcription pipeline that joins a Zoom meeting via RTMS and
publishes transcripts to a Redis Stream. That pipeline is fully built and
verified end-to-end with real audio, real Deepgram, real Postgres, and real
Redis — but the Zoom-specific bot-join layer (`ZoomBotAdapter`) cannot be
live-tested: Zoom RTMS requires purchased "Developer Pack" credits and a paid
host plan, unavailable on this account (Basic/free).

Rather than pay for that, this sub-project replaces the *meeting source* with
LiveKit (a free, open-source-backed WebRTC platform with a generous free cloud
tier) so Falcon can be built as its own product first. Zoom becomes an
optional future integration for users who bring their own paid Zoom account —
not something this project depends on.

## Goals

- Let real people join a Falcon-hosted meeting room via a simple web page.
- Capture each participant's audio in real time via a bot that joins the same
  room, using LiveKit Cloud (free tier).
- Feed that audio into the **existing, unmodified** `TranscriptionManager` →
  `TranscriptPipeline` → Postgres/Redis Stream pipeline.
- Keep the meeting-source boundary as clean as `ZoomBotAdapter` already is, so
  Zoom can be added later as a second, optional adapter without disrupting
  this one.

## Non-goals (out of scope for this sub-project)

- Zoom, Google Meet, or Teams integration (may come later, per the original
  design's roadmap).
- Role selection (Engineer/PM/QA/etc.) on the join page — deferred to the
  future Dynamic Agent Manager sub-project. The join page only collects a name.
- Multiple concurrent meetings/rooms — same "single meeting at a time"
  simplicity as the Zoom sub-project.
- Any Knowledge Graph, agent, or coordinator logic.

## Approaches considered

**A. `@livekit/rtc-node` directly (chosen).** A Node.js process joins the
LiveKit room as a regular bot participant, subscribes to each participant's
audio track via `RoomEvent.TrackSubscribed`, and reads raw frames via
`AudioStream`. Architecturally identical to `ZoomBotAdapter` — a thin adapter
translating a third-party real-time API into our own narrow event interface.

**B. `@livekit/agents` (agents-js) framework.** LiveKit's own opinionated
framework for building AI voice agents: a background "worker" waits for
LiveKit to assign it a room ("job"), then an agent instance joins with
built-in turn-detection and voice-activity-detection. Rejected: it's a
fundamentally different control-flow model (job/worker) than the rest of this
codebase, and we'd be fighting its abstractions rather than using them, since
`TranscriptionManager` already owns STT orchestration ourselves. Overkill for
"give me per-participant audio."

## Architecture

```
Browser (join page) ──WebRTC──► LiveKit Cloud room ◄──WebRTC── LiveKitBotAdapter (Node.js)
                                       │                              │
                              (webhooks: room started/                ▼
                               finished, participant          TranscriptionManager → TranscriptPipeline
                               joined/left)                       (unchanged)              │
                                       │                                          Postgres / Redis Stream
                                       ▼                                            (unchanged)
                              Our server's webhook endpoint
```

### Components

**Join page** (`public/join.html`, using `livekit-client` — LiveKit's browser
SDK) — a name field and a "Join" button. On submit: request a token from our
server, then connect directly to the LiveKit room over WebRTC. No role
selection, no other fields.

**Token endpoint** (a small HTTP handler on the existing server) — uses
`livekit-server-sdk`'s `AccessToken` to mint a signed join token for whatever
name the participant typed. That name becomes the participant's LiveKit
"identity," which flows straight into our existing `participantId`/
`displayName` fields with no translation needed.

**`LiveKitBotAdapter`** (`src/livekit/liveKitBotAdapter.ts`) — the direct
sibling of `ZoomBotAdapter`. Composes a `LiveKitWebhookSource` (room-started/
room-finished, participant-joined/left — LiveKit Cloud sends these as
standard webhooks, no paid tier required) and a `LiveKitRoomLike` (joins as a
bot participant via `@livekit/rtc-node`, subscribes to each participant's
audio track) into the same event surface `ZoomBotAdapter` already emits:
`meetingStarted`, `participantJoined`, `participantLeft`, `audioChunk`,
`meetingEnded`. Both interfaces live in `liveKitBotAdapter.types.ts`; the real
implementations (`realLiveKitRoom.ts`, `realLiveKitWebhookSource.ts`) are
excluded from unit-test coverage, matching the Zoom pattern exactly — they're
only exercised by the manual/live test.

**Shared adapter interface (targeted change to existing code)**:
`wireTranscriptionPipeline` currently types its first parameter as the
concrete `ZoomBotAdapter` class. A small shared interface — `MeetingSourceAdapter`,
describing just the five events both adapters emit — replaces that
parameter type, so `wireTranscriptionPipeline`, `TranscriptionManager`, and
`TranscriptPipeline` work unchanged with either meeting source. This is the
one piece of existing code this sub-project touches, and only to widen a
type, not to change behavior.

Since Falcon Meet is our own product, "a meeting" starts when the first real
participant joins the room (LiveKit's `room_started` webhook) — there's no
Zoom-style external scheduling concept to bridge. Same "single meeting at a
time" simplicity carries over from the Zoom sub-project.

### Data flow

1. Server starts; the webhook listener is registered and waiting.
2. A participant opens the join page, types a name, clicks Join → the browser
   fetches a token from our server → connects to the LiveKit room over WebRTC.
3. LiveKit Cloud sends a `room_started` webhook (first participant joined an
   empty room) → our bot joins that same room via `@livekit/rtc-node` →
   `LiveKitBotAdapter` emits `meetingStarted(meetingId, participants)`
   (`meetingId` = the LiveKit room name).
4. As the bot subscribes to each participant's audio track
   (`RoomEvent.TrackSubscribed`), frames flow through `AudioStream` → the
   adapter emits `audioChunk(participantId, buffer, timestamp)` — from here
   the flow is identical to the Zoom sub-project:
   `TranscriptionManager` → `TranscriptPipeline` → Postgres/Redis.
5. Participants joining/leaving mid-meeting → `participantJoined`/
   `participantLeft`, via LiveKit webhooks or the bot's own
   `RoomEvent.ParticipantConnected`/`Disconnected`.
6. Room goes empty → `room_finished` webhook → bot leaves → `meetingEnded("ended")`.

### Failure semantics

- **Webhook signature verification**: LiveKit Cloud signs webhook payloads;
  verified using their SDK's helper before trusting a request — same
  principle as Zoom's `ZOOM_WEBHOOK_SECRET_TOKEN` check.
- **Bot join/reconnect**: whether `@livekit/rtc-node`'s `Room` handles
  reconnection internally, or whether `LiveKitBotAdapter` needs its own
  reconnect-with-backoff (matching `ZoomBotAdapter`'s
  `reconnectAttempt`-resets-on-success pattern), needs verifying in an early
  spike task before the rest is built on top of it. If reconnection is
  exhausted, emit `meetingEnded("ended_error")`, matching the existing pattern.
- **`AudioStream` stability**: a past GitHub issue reported crashes creating
  an `AudioStream` on `TrackSubscribed` in earlier SDK versions. Exactly the
  kind of assumption that turned out wrong for the Deepgram SDK — the
  implementation plan opens with a spike task (mirroring Task 1 of the Zoom
  sub-project) that verifies this against the actually-installed SDK version
  before anything else depends on it.

### Testing

- **Unit**: `LiveKitBotAdapter` tested against fakes (`LiveKitRoomLike`,
  `LiveKitWebhookSource`), directly reusing the structure of
  `tests/unit/zoomBotAdapter.test.ts`.
- **Integration**: adapt `tests/integration/pipeline.integration.test.ts`'s
  pattern — a synthetic `LiveKitBotAdapter` driving the real
  `TranscriptionManager`/`TranscriptPipeline` against real Postgres/Redis.
- **Manual/live**: an actual join-page test with two real people talking —
  and unlike the Zoom sub-project's Task 16, this should be achievable for
  free on LiveKit Cloud's tier rather than blocked by billing.

## Long-term Falcon architecture (context, not designed here)

Unchanged from the original design spec — this sub-project only replaces the
meeting-source layer. The Redis Stream this produces is exactly the same
public contract downstream consumers (Knowledge Graph Builder, Dynamic Agent
Manager, Main Falcon Coordinator) will read from, regardless of whether the
audio came from Zoom or LiveKit.
