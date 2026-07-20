# Falcon Roadmap

## Verified 2026-07-16: real Deepgram/Postgres/Redis pipeline works end-to-end

Since RTMS itself is blocked by billing (below), verified everything downstream of the Zoom bot-join layer against a real recorded voice clip instead: `scripts/live-audio-verification.ts` (`npm run verify:live-audio -- <audio-file>`) streamed real audio through the real `TranscriptionManager` → real Deepgram → real `TranscriptPipeline` → real Postgres/Redis. Result: correct live transcription ("Hi. My name is Guru Wanchuk.", confidence 0.998) landed in both.

Along the way this found and fixed a **real, previously-unknown bug**: `@deepgram/sdk@5.5.0`'s `listen.v1.connect()` wrapper never reached `OPEN` in this environment even with valid credentials (`readyState` stuck at `CLOSED`, no error/close event, no debug output). Isolated via the `ws` package succeeding immediately with an identical URL/headers — the fault was in the SDK wrapper itself. A second bug compounded it: Deepgram's real auth header is `Authorization: Token <apiKey>`, not the bare key. `src/transcription/deepgramClient.ts` now talks to Deepgram via `ws` directly; `@deepgram/sdk` is no longer a dependency. See `CLAUDE.md`'s "Real vs. fake adapters" section for the full detail.

## Right now: live-verifying the transcription pipeline (Task 16)

Sub-project 1 (meeting ingestion & transcription) is fully built, reviewed, and merged to `master` — 42/42 automated tests pass. The one thing left is Task 16: proving it actually works against a real Zoom meeting, since `@zoom/rtms` can't run on Windows and had never been executed until this session.

**Environment set up so far:**
- WSL2 (Ubuntu 26.04) installed on this machine, with Node 22 and the project cloned natively at `~/falconai` (not the slower Windows-mounted path).
- Postgres (Windows-hosted, via Scoop) reconfigured to accept connections from the WSL subnet (`172.31.208.0/20`) — `listen_addresses='*'` + a `pg_hba.conf` trust rule, both approved by the user.
- Redis (Windows-hosted, via Scoop) had its protected mode disabled so WSL can actually issue commands, not just complete the TCP handshake — approved by the user.
- `ngrok` installed in WSL, tunnel running: forwards a public HTTPS URL to the server's port 8080 (URL changes each time the tunnel restarts — check current one with `curl -s http://127.0.0.1:4040/api/tunnels`).
- The Falcon server (`npm run dev`) runs in the background in WSL, credentials loaded from `.env`.

**Zoom Marketplace app ("General app 861", user-managed) configured so far:**
- Client ID / Secret, Webhook Secret Token — all in `.env`.
- Event Subscription: webhook endpoint set to the ngrok URL, subscribed to "RTMS Started In Meeting" / "RTMS Stopped In Meeting".
- OAuth authorized/installed to the developer's own Zoom account (via Local Test → Add app).
- Surface tab: "Meetings" selected as a supported product (required — RTMS features were disabled without a product selection).
- Scopes: adding `rtms:read:rtms_started`, `rtms:read:rtms_stopped`, `zoomapp:inmeeting` (in progress) — needed to unlock the "Allow auto-start for RTMS apps" toggle, which was blocked with "This feature requires RTMS scopes."

**Root cause found (2026-07-16):** the "Allow auto-start for RTMS apps" toggle stayed permanently blocked ("This feature requires RTMS scopes") no matter what scopes were added, and no webhook ever arrived even while actively speaking in a real meeting. Confirmed via Zoom's own RTMS docs and developer forum: **RTMS requires purchasing "Developer Pack" credits** (a paid add-on, not included in any plan by default), and **Basic/free-tier meeting hosts get an explicit "App could not reach meeting content" error** when attempting to start RTMS. This account is on Zoom **Basic (free)** — that is almost certainly the actual blocker, not a configuration mistake. Every app-side setting (events, scopes, OAuth, product selection) was configured correctly.

**To unblock Task 16 live verification:** the account needs (1) a paid Zoom plan (Pro or above) for the meeting host, and (2) RTMS Developer Pack credits purchased via [Zoom's developer pricing page](https://developers.zoom.us/pricing/). This is a cost/access decision for the user, not something to route around in code — the exact credit threshold/price wasn't available in what was checked; the pricing page or Zoom sales would have current numbers.

**Environment is otherwise fully ready to go** the moment plan/credits are sorted: WSL2 + Node + project clone, Postgres/Redis reachable from WSL, ngrok tunnel, and the Zoom app itself (events, scopes, OAuth) are all already configured. Nothing else should need touching — just start a meeting and speak once RTMS is actually entitled on the account.

**Once a webhook does arrive**, next debugging steps if something's still wrong: check `docs/superpowers/notes/zoom-rtms-capability-findings.md` for the specific real-vs-assumed API details already discovered (webhook payload shape, `userId` type, event name spelling), and update `src/zoom/realWebhookSource.ts` / `realRtmsClient.ts` if reality differs from what's coded.

## Done: LiveKit-based meeting ingestion ("Falcon Meet") — all 11 tasks complete

Second meeting-source, built as an alternative to Zoom RTMS (blocked on billing, above): `LiveKitBotAdapter` is a drop-in sibling of `ZoomBotAdapter` (same five-event surface via a shared `MeetingSourceAdapter` interface), feeding the same unmodified `TranscriptionManager`/`TranscriptPipeline`/Postgres/Redis pipeline. See `docs/superpowers/specs/2026-07-16-livekit-meeting-ingestion-design.md` and `docs/superpowers/plans/2026-07-16-livekit-meeting-ingestion.md` (11-task plan).

**Tasks 1-10 complete and reviewed** (per-task review + a final whole-branch review), 54/54 automated tests passing. Three plan-mandated bugs found during per-task review were fixed: stale-meetingId leakage on `participantJoined`/`participantLeft` in `LiveKitBotAdapter`, unhandled `room.connect()`/`disconnect()` rejections, and an unhandled-rejection crash risk in the real audio-stream iteration loop.

**The final whole-branch review surfaced one new issue not visible at the single-task level**, before this was tested live:
- **Likely double-emit of `meetingEnded` on every clean meeting end** — **fixed** (`0772772`): `handleDisconnected` now guards with `if (!this.room) return;`, a no-op once `handleRoomFinished` has already cleared `this.room` and emitted the correct `"ended"`. Covered by a new regression test in `tests/unit/liveKitBotAdapter.test.ts`; 47/47 unit tests pass.
- Also noted: LiveKit meetings' `meeting_lifecycle: started` event always carries an empty participant roster (the `participantJoined` webhook event isn't wired to anything) — a known v1 gap, not a bug; transcript attribution itself is unaffected.
- The `handleDisconnected` "only fires once the SDK has given up" assumption is unverified — Task 1's live capability spike is still marked PENDING (no LiveKit Cloud account set up yet).

**Task 11 (manual test with real participants)**: in progress.
- Done (2026-07-19): user signed up for a free LiveKit Cloud account
  (`falcon-ai-vzhdw96i.livekit.cloud`) and added
  `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`/`LIVEKIT_URL` to `.env`.
- Done (2026-07-19): ran Task 1's live capability spike (`npm run
  spike:livekit`) with a real human joining via `meet.livekit.io` and
  speaking. Confirmed: `AudioStream` runs cleanly with no crashes,
  delivering correctly-formatted 16kHz mono 10ms frames; a participant
  leaving fires only `ParticipantDisconnected`, never the bot's own
  `RoomEvent.Disconnected` (confirms `LiveKitBotAdapter`'s core assumption).
  Still unobserved: real `Disconnected` reason codes and
  `Reconnecting`/`Reconnected` behavior (would need the bot's own
  connection to actually drop, which didn't happen naturally in this
  session). Full detail in `docs/superpowers/notes/livekit-capability-findings.md`.
- In progress (2026-07-19): ran `npm run dev:livekit` end-to-end with a
  real participant (one person so far, not two) joining via the browser
  join page, with a public tunnel (`cloudflared tunnel --url
  http://localhost:8081` — ngrok's Windows binary wasn't downloadable
  from this environment; `bin.equinox.com` didn't resolve) forwarding
  LiveKit Cloud's webhook to `/livekit-webhook`. Found and worked around
  three non-obvious webhook-testing gotchas — now documented in
  `CLAUDE.md`'s "Local webhook-testing gotchas" section: `room_started`
  only fires on room creation not every join; a hard-killed spike-script
  process left a ghost participant that kept the room permanently
  non-empty; the dashboard's "Send test" button sends a fake `room.name:
  "Demo Room"` event, not the real room.
- **Found and fixed a real bug** (this session): Deepgram's `duration`
  field is a float; multiplying by 1000 for `durationMs` produced
  fractional milliseconds that Postgres's `bigint` columns reject
  outright, silently failing *every* transcript persistence during the
  live test (Postgres failures only log-and-continue, so there was no
  visible symptom). Fixed in `src/transcription/deepgramClient.ts` by
  rounding to the nearest integer millisecond. 47/47 unit tests still
  pass. Documented in `CLAUDE.md`'s "Timestamp normalization" section.
- **Confirmed working end-to-end structurally**: with the bot genuinely
  connected to the real `falcon-meet` room (verified via
  `RoomServiceClient.listParticipants()`) alongside a real human
  participant, `meeting_lifecycle: started` and both interim and final
  transcript events landed in the Redis Stream with correct shape,
  sequencing, and the real participant's identity as `participantId`.
- **Resolved (2026-07-20): the empty-transcript/confidence-0 bug, root cause found and fixed.**
  Picked back up with the amplitude check this doc called for: added temporary
  per-frame peak-amplitude logging to `realLiveKitRoom.ts` and raw-response logging
  to `deepgramClient.ts`, plus a standalone spike (`scripts/livekit-manual-bot-test.ts`)
  that connects a bot directly to the room, bypassing the webhook entirely (see the
  webhook-delivery note below). This proved real, non-silent audio was reaching
  Deepgram throughout — ruling out the muted-mic theory — and that Deepgram
  transcribed the first ~3.75 minutes of English speech correctly (e.g. "Hello. Can
  you hear me?" at confidence 0.976) before permanently degrading to empty/
  confidence-0 for every result afterward, regardless of continued healthy audio
  amplitude. Cross-referencing the frame counters in the diagnostic log found the
  actual cause: a **second `RoomEvent.TrackSubscribed` fired for the same
  participant mid-session** (a normal WebRTC renegotiation/track-republish, not an
  error), and the old code started an unguarded second `AudioStream` loop each time
  this happened — both loops then pushed frames into the same callback array
  concurrently, interleaving two independent audio streams into one corrupted byte
  sequence handed to the single Deepgram session, which correctly declined to
  transcribe garbage. **Fixed** in `src/livekit/realLiveKitRoom.ts`: track the active
  `AudioStream` per participant identity and `.cancel()` the previous one before
  starting a new one on re-subscription, with a `console.warn` so a recurrence is
  visible in production logs rather than silent. 55/55 automated tests still pass.
  Verified live: re-ran the direct-connect spike after the fix and got clean,
  accurate final transcripts with no corruption.
- **Webhook-delivery issue (above) resolved itself (2026-07-20)**: after the earlier
  session found zero `POST /livekit-webhook` deliveries across three genuine
  room-creation attempts despite a correctly-configured URL, a later re-test (same
  URL, same everything) started receiving real deliveries from LiveKit Cloud
  (`Go-http-client/2.0`) reliably — multiple `room_started`/`participant_joined`
  events landed correctly, signature verification succeeded, and the real
  `falcon-bot` identity joined `falcon-meet` via the actual production webhook path
  for the first time. Most likely explanation: a delayed config propagation on
  LiveKit Cloud's side that had simply not finished earlier. No code change was
  needed or made to `realLiveKitWebhookSource.ts`/`livekitIndex.ts`. Given it
  resolved without any action here, if it recurs, waiting and retrying is the
  first thing to try before assuming a code regression.
- **First successful real end-to-end run via the actual production path** (2026-07-20,
  same session as the audio-interleaving fix above): with the webhook now
  delivering, `npm run dev:livekit` ran unmodified — real webhook → `LiveKitBotAdapter`
  → `TranscriptionManager` → real Deepgram → real Postgres/Redis, no bypass script
  involved. Confirmed via direct queries against both stores: Postgres
  `transcript_events` for `falcon-meet` contains accurate final transcripts
  correctly attributed to the real participant identity (e.g. `"Hello. Hello. My
  name is"` at confidence 0.996, matching the phrase actually spoken), and the
  Redis Stream (`meeting:falcon-meet:transcript`) carries correctly-interleaved
  interim/final transcript entries plus lifecycle events in the documented wire
  format, with monotonically increasing `sequenceNumber`. The audio-interleaving
  fix above also proved itself live in this same run — a genuine mid-session
  re-subscription triggered the guard's `console.warn` and was handled cleanly
  instead of corrupting the transcript.
- Local infra note: Postgres and Redis are Scoop-installed on this
  Windows machine but are **not** registered as Windows services — they
  don't start automatically and must be started manually each session:
  `pg_ctl -D <scoop>/persist/postgresql/data start` and `redis-server
  <scoop>/apps/redis/current/redis.conf` (run from that directory to
  avoid a Git-Bash path-translation issue with the config path argument).
  `cloudflared` (installed via `scoop install cloudflared`) is a working
  alternative to ngrok for the local webhook tunnel.
- **Task 11 fully closed (2026-07-20): real two-person test passed.** Both
  real human participants (`Guru Wangchuk`, `KodaDev`) joined the same real
  `falcon-meet` room via the browser join page and spoke concurrently.
  LiveKit Cloud's webhook delivery went silent again in this session
  (same non-deterministic gap as before, no config change needed) — worked
  around by manually constructing and POSTing a correctly-signed
  `room_started` event straight to the already-running server's
  `/livekit-webhook` endpoint (same signature scheme LiveKit itself uses via
  `livekit-server-sdk`'s `AccessToken`/`WebhookReceiver`), rather than
  routing around any of Falcon's own code. Everything downstream — real
  `LiveKitBotAdapter`, real `room.connect()`, real per-participant
  `TranscriptionManager` sessions, real Deepgram, real Postgres/Redis — ran
  unmodified. Result: 85 final transcript rows persisted, correctly
  attributed per real participant identity with no cross-speaker audio
  corruption (e.g. `Guru Wangchuk`: "I need it twice." at confidence 0.79;
  `KodaDev` also transcribed distinctly) — confirming the `TrackSubscribed`
  audio-interleaving fix from earlier this session holds with two
  simultaneous real speakers, not just one. See `CLAUDE.md`'s "Local
  webhook-testing gotchas" section for the reusable manual-trigger recipe.
  **This closes the 11-task LiveKit Meeting Ingestion Implementation Plan.**

## What's next for the full Falcon vision

Sub-project 1 is only the "ears" — real-time listening, transcription, and publishing to a Redis Stream. Everything below is **not built yet**; each needs its own brainstorm → spec → plan → implementation cycle, same as sub-project 1 did. This list is the long-term architecture already captured in the design spec (`docs/superpowers/specs/2026-07-15-meeting-ingestion-transcription-pipeline-design.md`, "Long-term Falcon architecture" section) as context, not a design.

```
Redis Stream (done)
  │
  ▼
Knowledge Graph Builder      <- turns raw transcript events into structured decisions/entities
  │
  ▼
Decision Extractor           <- identifies concrete decisions made during discussion
  │
  ▼
Entity Resolver              <- resolves people/features/tickets mentioned to stable identities
  │
  ▼
Knowledge Graph              <- the shared, queryable store everything below reads from
  │
  ▼
Dynamic Agent Manager        <- creates one Falcon agent per meeting participant, seeded with
  │                              their role, meeting agenda, prior work, GitHub PRs, Jira/Linear
  │                              tickets, and past engineering decisions
  ▼
Engineer / PM / QA / Designer / Architect / DevOps / Security / Data Agents (one per participant,
  │                                                                          role-based, no fixed limit)
  ▼
Main Falcon Coordinator      <- has been listening from the start; mediates when agents' perspectives
                                 conflict (e.g. SD says Feature A, PM says Feature B) rather than only
                                 reacting when asked
```

Realistic order to tackle these (each is its own sub-project, brainstormed separately when we get there):

1. **Knowledge Graph Builder** — the natural next step once the transcript stream is proven live; without it, agents have no structured context to reason over.
2. **Dynamic Agent Manager** — creates the actual per-role agents; depends on the Knowledge Graph existing (even a minimal version) to seed agents with real context.
3. **Main Falcon Coordinator** — the mediation/debate logic; depends on multiple agents already existing to have something to coordinate between.

None of these have a UI either, by the same reasoning as sub-project 1 — unless we decide participants need to *see* agent output live in the meeting, which would be its own design decision when we get there.
