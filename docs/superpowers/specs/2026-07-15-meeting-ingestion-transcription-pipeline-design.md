# Meeting Ingestion & Transcription Pipeline — Design

**Status:** Approved
**Date:** 2026-07-15

## Context

Falcon's long-term vision is a multi-agent AI engineering team that participates
live in meetings: a dedicated Falcon agent per role (Engineer, PM, QA, Designer,
Architect, DevOps, Security, Data Scientist, ...), coordinated by a Main Falcon
Coordinator that mediates discussion and debate in real time.

That whole system is too large to design or build as one project. This document
scopes only the first, foundational sub-project: **getting a live, speaker-attributed
transcript out of a real Zoom meeting and onto a stream other subsystems can consume.**
Nothing here depends on the agent/reasoning layer existing yet, and nothing in the
agent/reasoning layer should need to know how this pipeline works internally.

## Goals

- Join a real Zoom meeting as a bot and capture audio in real time.
- Produce a speaker-attributed, ordered transcript stream with low latency.
- Persist the transcript for later use (post-meeting summaries, historical context).
- Expose a stable, minimal public contract so downstream AI components can be
  designed and built independently of this pipeline's internals.

## Non-goals (out of scope for this sub-project)

- Any AI reasoning, agent behavior, or coordination logic.
- Google Meet / Microsoft Teams support (Zoom only, for now).
- Multiple concurrent meetings (single meeting at a time, for now).
- Building the Knowledge Graph, Decision Extractor, Entity Resolver, Dynamic
  Agent Manager, or Main Falcon Coordinator (see "Long-term Falcon Architecture"
  below — captured as context, not designed here).

## Approaches considered

**A. Monolithic service.** One process does everything: Zoom join, STT management,
persistence. Fastest to build, but couples Zoom lifecycle, STT management, and
persistence together, making it harder to test in isolation or scale out later.

**B. Full microservices.** Three independently deployable services (bot capture,
STT worker, transcript store) talking over a queue. Maximally scalable, but for a
single-meeting prototype this is premature infrastructure with no near-term payoff.

**C. Modular monolith (chosen).** One deployable service, internally split into
three modules with explicit interfaces. Each module could become its own service
later with no interface changes — just move the module and add a network hop.
Avoids A's coupling and B's premature infra, while leaving a real seam for
multi-meeting scale-out as a future sub-project.

## Architecture

```
Zoom
  │
  ▼
ZoomBotAdapter
  │
  ▼
TranscriptionManager
  │
  ▼
TranscriptPipeline
  │
  ├──► Postgres (persistence, final events only)
  │
  └──► Redis Stream  ◄── subsystem's public contract
          │
──────────┼──────────────────────────────────────────
          ▼
   Falcon AI Platform (future sub-projects, not designed here)
   Knowledge Graph Builder → Decision Extractor → Entity Resolver
   → Dynamic Agent Manager → Engineer/PM/QA/Designer/Architect/... Agents
   → Main Falcon Coordinator
```

### Components

**`ZoomBotAdapter`** — wraps the Zoom RTMS/Meeting SDK bot join lifecycle. Joins a
meeting given a `meetingId`/join token. This is the only module that touches the
Zoom SDK; everything downstream is Zoom-agnostic. Emits:

- `meetingStarted(meetingId, participants[])`
- `participantJoined(participantId, displayName)`
- `participantLeft(participantId)`
- `audioChunk(participantId, pcmBuffer, timestamp)`
- `meetingEnded()`

**`TranscriptionManager`** — owns speech-to-text. Maintains transcription sessions
according to the capabilities of the meeting platform: when isolated per-participant
audio is available, it opens one streaming Deepgram session per participant. Otherwise
it runs a single session with speaker diarization enabled and maps diarized labels to
participant identities using Zoom's join/leave and active-speaker signals. Both code
paths sit behind the same interface — which one is exercised is a capability check
at runtime, not a design fork. Normalizes STT results into `TranscriptEvent`s.

**Session lifecycle:** a transcription session is created when speech begins (or
when the first audio is received, depending on provider capabilities). Sessions
remain active while speech continues and are closed after a configurable
inactivity timeout, or immediately when a participant leaves the meeting. This
minimizes connection overhead while avoiding unnecessary long-lived streaming
sessions.

**Implementation prerequisite:** before implementation begins, verify Zoom's
meeting integration model (RTMS vs. Meeting SDK) and whether isolated
participant audio streams are available. The outcome of this spike determines
the concrete implementation of `ZoomBotAdapter`, but does not change the
interfaces between `ZoomBotAdapter`, `TranscriptionManager`, and
`TranscriptPipeline`.

**`TranscriptPipeline`** (persistence + event distribution) — takes `TranscriptEvent`s,
assigns each a monotonic `sequenceNumber` per meeting, persists **final** events to
Postgres, and publishes **every** event (interim + final) to a Redis Stream. Interim
events go out live so downstream consumers can react with low latency; only final
text is persisted, to avoid storing noisy in-progress guesses.

### Event contract

The `TranscriptEvent` is the formal contract between internal modules:

```typescript
type STTProvider = "deepgram" | "assemblyai" | "whisper";

interface TranscriptEvent {
  version: 1;
  utteranceId: string;       // stable ID shared by interim and final revisions of the same utterance
  meetingId: string;
  participantId: string;
  speakerName: string;
  text: string;
  isFinal: boolean;
  startTs: number;
  endTs: number;
  confidence: number;
  source: STTProvider;
  sequenceNumber: number;    // monotonic per meetingId, assigned by TranscriptPipeline
}
```

Without `utteranceId`, downstream consumers can't tell that several interim
updates belong to the same spoken sentence rather than separate utterances.

The stream also carries lifecycle control events bracketing each meeting's
transcript events: `{ type: "meeting_lifecycle", meetingId, status: "started" |
"ended" | "ended_error", timestamp, participants? }`. This lets a consumer
subscribing mid-stream tell where a meeting begins/ends without a separate channel.

**Timestamp normalization:** all timestamps are normalized to the meeting
timeline, using `meetingStarted` as the reference point. This ensures
transcript events remain comparable regardless of whether they originate from
multiple per-participant transcription sessions or a single diarized session.

**The Redis Stream (`meeting:{meetingId}:transcript`) is this subsystem's public
interface.** Downstream consumers — the Knowledge Graph Builder, Decision Extractor,
Dynamic Agent Manager, and anything else in the Falcon AI platform — only ever
consume the stream. They never call `ZoomBotAdapter`, `TranscriptionManager`, or
`TranscriptPipeline` internals directly. This is what lets Postgres, Deepgram, or
even Zoom itself be swapped later without touching downstream code.

### Data flow

1. Zoom meeting starts → `ZoomBotAdapter` joins as bot, emits `meetingStarted`.
2. `TranscriptPipeline` publishes a `meeting_lifecycle: started` event first, and
   opens the meeting's row in Postgres.
3. As people speak, `ZoomBotAdapter` emits `audioChunk`s; `TranscriptionManager`
   routes them to the right Deepgram session (per-participant or diarized) and
   normalizes results into `TranscriptEvent`s (sans `sequenceNumber`).
4. `TranscriptPipeline` assigns the next `sequenceNumber` for that meeting (single
   writer, so no race), persists final events to Postgres, and publishes every
   event to the Redis Stream.
5. On meeting end, `ZoomBotAdapter` emits `meetingEnded()` → `TranscriptPipeline`
   publishes `meeting_lifecycle: ended` as the closing event.

### Failure semantics

- **`ZoomBotAdapter`**: on disconnect from Zoom, reconnect with exponential
  backoff. If reconnection ultimately fails, publish `meeting_lifecycle:
  ended_error` rather than a clean `ended`, so consumers know the feed stopped
  abnormally.
- **`TranscriptionManager`**: a dropped Deepgram session is reconnected
  independently per participant (others unaffected). Audio arriving during the
  reconnect window is buffered in a small bounded queue (a few seconds); beyond
  that it's dropped with a logged warning rather than risking unbounded memory
  growth.
- **`TranscriptPipeline`**: Postgres write failures retry with backoff and
  log/alert on persistent failure — live delivery to Redis takes priority over
  persistence, since downstream reasoning depends on the live feed;
  `sequenceNumber` lets a recovered DB backfill detectable gaps. Redis publish
  failures are more serious (it's the public contract) and are retried
  aggressively, escalating to an alert if sustained.
- **Delivery guarantees**: consumers should treat events as **at-least-once
  delivered** (a reconnect can cause a duplicate publish) and **idempotent**,
  using `(meetingId, sequenceNumber)` as the dedupe key. Ordering is preserved
  per meeting via the monotonic `sequenceNumber`.

### Testing

- **Unit**: `TranscriptEvent` normalization for both per-participant and
  diarized modes (mocked Deepgram responses); `sequenceNumber` assignment;
  `ZoomBotAdapter` event emission against a mocked Zoom SDK.
- **Integration**: a synthetic `ZoomBotAdapter` feeding fabricated audio through
  the real pipeline, verifying events land in Postgres and on the Redis Stream
  in order, correctly bracketed by `meeting_lifecycle` events.
- **Contract test**: a standalone consumer that reads *only* the Redis Stream
  (no internal imports) — this proves the "Redis is the public contract"
  boundary actually holds, not just documents it.
- **Manual/live**: a real Zoom test meeting with multiple speakers, checking
  transcript accuracy, correct speaker attribution, and end-to-end latency.

## Long-term Falcon architecture (context, not designed here)

Captured for continuity across future sub-projects; none of this is designed or
scoped by this document:

```
Redis Stream
  │
  ▼
Knowledge Graph Builder
  │
  ▼
Decision Extractor
  │
  ▼
Entity Resolver
  │
  ▼
Knowledge Graph
  │
  ▼
Dynamic Agent Manager
  │
  ▼
Engineer Agent / PM Agent / QA Agent / Designer Agent / Architect Agent / ...
  │
  ▼
Main Falcon Coordinator
```

Each participant in a meeting is paired with a dynamically-created Falcon agent
matching their role. Agents are created when a meeting begins, based on
participants and their assigned roles, and are seeded with meeting agenda,
participant role, prior work, assigned tasks, related GitHub PRs, Linear/Jira
tickets, and past engineering decisions (sourced from the Knowledge Graph).
Agents update continuously as the discussion evolves, and the Main Falcon
Coordinator — which has been listening from the start — mediates when
participants' agents surface conflicting perspectives (e.g. an SD agent and PM
agent proposing different features), rather than reacting only when asked.

The Knowledge Graph is intended to become the center of Falcon: the shared,
queryable representation of decisions, entities, and context that every role
agent and the Main Coordinator draw from, built from this pipeline's transcript
stream by the (separately designed) Knowledge Graph Builder, Decision Extractor,
and Entity Resolver.
