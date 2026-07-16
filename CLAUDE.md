# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Falcon Transcription Service: a Node.js/TypeScript service that joins a Zoom meeting as a bot via RTMS (Realtime Media Streams), transcribes audio in real time via Deepgram, persists final transcript events to Postgres, and publishes every event (interim + final) plus meeting-lifecycle events to a Redis Stream. That Redis Stream is the intentional public contract of this subsystem — it is the first sub-project of a larger planned system ("Falcon") where downstream consumers (a Knowledge Graph Builder, per-role AI agents, a coordinator) will read from it. Those consumers do not exist yet in this repo; do not build them without a design doc.

Read `docs/superpowers/specs/2026-07-15-meeting-ingestion-transcription-pipeline-design.md` for the full design rationale and `docs/superpowers/plans/2026-07-15-meeting-ingestion-transcription-pipeline.md` for the task-by-task implementation plan (both still accurate references for *why* things are shaped the way they are).

## Commands

```bash
npm test                              # vitest run -- full suite (unit + integration + contract)
npx vitest run tests/unit             # fast, no external services needed
npx vitest run tests/integration      # needs local Postgres + Redis reachable (see below)
npx vitest run path/to/one.test.ts    # single file
npm run build                         # tsc -p . (type-check + emit to dist/; tests are NOT compiled here)
npm run dev                           # tsx src/server/index.ts -- the real server entry point
npm run migrate                       # tsx src/db/runMigrate.ts -- applies src/db/schema.sql
npm run spike:rtms                    # tsx scripts/rtms-capability-check.ts -- manual Zoom RTMS probe, see Task 1 notes below
```

Local dependencies for integration/contract tests (not started automatically):
- Postgres reachable at `DATABASE_URL`, with `npm run migrate` already run against database `falcon_transcription`.
- Redis reachable at `REDIS_URL`.
- Copy `.env.example` to `.env` and fill in `DATABASE_URL`/`REDIS_URL` at minimum; `ZM_RTMS_CLIENT`/`ZM_RTMS_SECRET`/`ZOOM_WEBHOOK_SECRET_TOKEN`/`DEEPGRAM_API_KEY` are only needed to run the real server (`npm run dev`) against a live meeting.

**`@zoom/rtms` cannot run on Windows** — no native binary for that platform (its own `package.json` restricts `os` to `linux`/`darwin`). `npm install` requires `--force` on Windows for this reason. `npm run dev`, `realRtmsClient.ts`, `realWebhookSource.ts`, and anything that imports `@zoom/rtms` transitively can only be *type-checked* (`npm run build`), never executed, on Windows. This is a real, permanent platform constraint, not a todo.

`tests/` is intentionally excluded from `tsconfig.json`'s `include` — `tsc -p .` only compiles `src/` and `scripts/`. Don't add `tests/**/*.ts` back to `include`; a prior attempt at that caused `tsc` to emit compiled test files into `dist/`, which vitest's default discovery then picked up as stale duplicates alongside the real `.ts` tests, breaking the suite.

## Architecture

Three modules in a strict pipeline, each behind a narrow interface so it can be unit-tested with fakes instead of the real Zoom/Deepgram/Postgres/Redis:

```
Zoom → ZoomBotAdapter → TranscriptionManager → TranscriptPipeline → Postgres
                                                                   → Redis Stream (public contract)
```

- **`ZoomBotAdapter`** (`src/zoom/zoomBotAdapter.ts`) — the *only* module allowed to know Zoom-specific details. Composes a `ZoomWebhookSource` (RTMS started/stopped + participant joined/left events) and an `RtmsClientLike` (audio/active-speaker/join/leave) into a plain event surface: `meetingStarted`, `participantJoined`, `participantLeft`, `audioChunk`, `activeSpeaker`, `meetingEnded("ended" | "ended_error")`. Both interfaces are defined in `zoomBotAdapter.types.ts`; the real implementations (`realRtmsClient.ts`, `realWebhookSource.ts`) live separately and are only wired in by `src/server/index.ts`, never referenced by tests. Has its own reconnect-with-exponential-backoff (`reconnectAttempt` resets on a successful join — it does *not* reset per-meeting elsewhere, since one adapter instance is reused for every meeting the process ever handles).

- **`TranscriptionManager`** (`src/transcription/transcriptionManager.ts`) — capability-aware STT session management. In `"per-participant"` mode it opens one Deepgram session per participant; in `"diarized"` mode it runs one shared session and resolves diarized speaker labels to real participant identities via `ActiveSpeakerTimeline` (fed by `ZoomBotAdapter`'s `activeSpeaker` events). **Only `"per-participant"` mode is wired in production** (`wireTranscriptionPipeline.ts`) — diarized mode is fully implemented and tested but currently unreachable outside tests. Owns its own reconnect-with-bounded-buffering per session, with a `failureCount` that only resets on an actual transcript result (proof the connection is alive) — this matters because the real Deepgram client never fails synchronously, only via async `onError`/`onClose`, so naively resetting on "session object created" would make the give-up threshold unreachable.

- **`TranscriptPipeline`** (`src/pipeline/transcriptPipeline.ts`) — the sole assigner of `sequenceNumber` (via `SequenceNumberAllocator`, `INCR` on a per-meeting Redis key). Persists only `isFinal: true` events to Postgres (`PostgresTranscriptStore`); publishes *every* event (interim + final) plus lifecycle events to Redis (`RedisTranscriptPublisher`). Failure semantics are asymmetric and deliberate: Postgres failures retry-then-log-and-continue (a DB outage must never block live delivery), Redis failures retry-then-log-and-rethrow (Redis is the public contract, so a publish failure must propagate).

**Timestamp normalization** is the trickiest cross-cutting concern: everything on the wire is meeting-relative milliseconds (`normalizeTimestamp(raw, meetingStartedAtMs)` in `src/lib/timestampNormalizer.ts`), never epoch time. `TranscriptionManager` derives `startTs`/`endTs` from each session's own last-seen *raw Zoom audio-chunk timestamp* combined with the STT provider's reported utterance `durationMs` — **not** from the STT provider's own internal clock, which is relative to when that provider's connection opened, not the meeting. `startTsRaw` is clamped to `meetingStartedAtMs` (never negative) for utterances already in progress when the bot joins. Lifecycle events (`meeting_lifecycle: started`/`ended`) are also meeting-relative (`started` is always `0` by definition), not epoch time — kept consistent with transcript events on purpose.

**Composition root split**: `src/server/wireTranscriptionPipeline.ts` contains all the Zoom-agnostic wiring (event handler registration, `TranscriptionManager` lifecycle, `TranscriptPipeline` calls) and has zero `@zoom/rtms` imports — this is what the integration test exercises. `src/server/index.ts` is a thin wrapper that additionally constructs the real Zoom pieces and calls `startServer()`. Keep this split: anything importing `@zoom/rtms` transitively cannot be required() at all on Windows, so pulling Zoom-specific code into the testable wiring function would break every test on this platform.

**`TranscriptionManager` is reconstructed fresh per meeting** (inside `wireTranscriptionPipeline`'s `meetingStarted` handler, not at server startup) so it gets the real `meetingStartedAtMs`. `closeAll()` is called on `meetingEnded` to explicitly tear down open STT sessions rather than waiting on the 5-minute inactivity timeout — necessary because the manager reference is reassigned on the next meeting, which would otherwise orphan the previous meeting's sessions from ever being cleaned up.

### Event contract (the actual wire format)

Defined in `src/types/transcriptEvent.ts`: `TranscriptEvent` (fixed shape: `version`, `utteranceId`, `meetingId`, `participantId`, `speakerName`, `text`, `isFinal`, `startTs`, `endTs`, `confidence`, `source: STTProvider`, `sequenceNumber`) and `MeetingLifecycleEvent` (`type: "meeting_lifecycle"`, `meetingId`, `status: "started" | "ended" | "ended_error"`, `timestamp`, `participants?`). On the Redis Stream (`meeting:{meetingId}:transcript`), both are wrapped as `{ kind: "transcript" | "meeting_lifecycle", payload: <JSON string> }` — this wrapper, not the internal TypeScript types, is the actual contract; `tests/contract/redisStreamContract.test.ts` deliberately imports nothing from `src/` to prove a future external consumer only needs the `redis` package and this wire format.

### Real vs. fake adapters (why some files are never unit-tested)

`src/zoom/realRtmsClient.ts`, `src/zoom/realWebhookSource.ts`, and `src/transcription/deepgramClient.ts` wrap the actual third-party SDKs and are deliberately excluded from unit-test coverage (they need live credentials/a live connection). Everything else is tested against fakes conforming to `RtmsClientLike`/`ZoomWebhookSource`/`DeepgramLiveConnectionLike`. When touching these three files, verify against the actually-installed package's type definitions in `node_modules/@zoom/rtms/rtms.d.ts` / the `@deepgram/sdk` dist types directly — both SDKs' real APIs have previously turned out to differ substantially from naive assumptions (see `docs/superpowers/notes/zoom-rtms-capability-findings.md` for the specifics already discovered: `@zoom/rtms`'s `join()` is synchronous and never throws, real success/failure comes later via `onJoinConfirm`; participant roster comes from `client.onParticipantEvent`, not a webhook; `userId` is a `number` not `string`; Deepgram's real streaming API is `listen.v1.connect`, not `listen.live()`, and only `v1` supports `diarize`).

### What's unverified

Task 16 of the implementation plan (a live run against a real Zoom meeting) has never been performed — no Zoom Marketplace app/credentials and no Linux/macOS environment have been available. The real-wiring files are type-check-verified only. Treat anything touching live Zoom behavior (webhook payload shape, exact event-name string, `onJoinConfirm` reason-code semantics) as unconfirmed until that live run happens.
