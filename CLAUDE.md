# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Falcon Transcription Service: a Node.js/TypeScript service that joins a Zoom meeting as a bot via RTMS (Realtime Media Streams), transcribes audio in real time via Deepgram, persists final transcript events to Postgres, and publishes every event (interim + final) plus meeting-lifecycle events to a Redis Stream. That Redis Stream is the intentional public contract of this subsystem — it is the first sub-project of a larger planned system ("Falcon") where downstream consumers (a Knowledge Graph Builder, per-role AI agents, a coordinator) will read from it. Those consumers do not exist yet in this repo; do not build them without a design doc.

Read `docs/superpowers/specs/2026-07-15-meeting-ingestion-transcription-pipeline-design.md` for the full design rationale and `docs/superpowers/plans/2026-07-15-meeting-ingestion-transcription-pipeline.md` for the task-by-task implementation plan (both still accurate references for *why* things are shaped the way they are).

A second meeting-source plan exists for when Zoom RTMS is unavailable (RTMS requires paid "Developer Pack" credits — see `ROADMAP.md`): `docs/superpowers/specs/2026-07-16-livekit-meeting-ingestion-design.md` and `docs/superpowers/plans/2026-07-16-livekit-meeting-ingestion.md` design a parallel LiveKit-based bot ("Falcon Meet"), a drop-in sibling of `ZoomBotAdapter` feeding the same unmodified pipeline. **Not implemented on this branch** — no `src/livekit/` directory or LiveKit dependency exists here. Check `git worktree list` (an entry under `.claude/worktrees/`) for in-progress or completed implementation before starting it from scratch.

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
npm run verify:live-audio -- <file>   # tsx scripts/live-audio-verification.ts -- real Deepgram/Postgres/Redis test from an audio file, no Zoom needed
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

`src/zoom/realRtmsClient.ts` and `src/zoom/realWebhookSource.ts` wrap `@zoom/rtms` and are deliberately excluded from unit-test coverage (they need live credentials/a live connection). Everything else is tested against fakes conforming to `RtmsClientLike`/`ZoomWebhookSource`/`DeepgramLiveConnectionLike`. When touching these two files, verify against the actually-installed package's type definitions in `node_modules/@zoom/rtms/rtms.d.ts` directly — its real API has previously turned out to differ substantially from naive assumptions (see `docs/superpowers/notes/zoom-rtms-capability-findings.md` for specifics already discovered: `join()` is synchronous and never throws, real success/failure comes later via `onJoinConfirm`; participant roster comes from `client.onParticipantEvent`, not a webhook; `userId` is a `number` not `string`).

**`src/transcription/deepgramClient.ts` does NOT use `@deepgram/sdk`** (it's not a dependency) — it talks to `wss://api.deepgram.com/v1/listen` via the `ws` package directly. This was a deliberate, verified fix: `@deepgram/sdk@5.5.0`'s `listen.v1.connect()` wrapper (a `ReconnectingWebSocket`) never reached `OPEN` in this environment even with valid credentials — `readyState` stuck at `CLOSED` indefinitely, no `close`/`error` event ever fired, no output even with `debug: true`. Confirmed via the `ws` package succeeding immediately with an identical URL/headers, which isolated the fault to the SDK wrapper itself. A second, compounding bug surfaced along the way: Deepgram's real auth header is `Authorization: Token <apiKey>` — the bare key alone gets a `401 INVALID_AUTH` that the SDK wrapper was also silently swallowing. `TranscriptionManager` already owns reconnect responsibility (see below), so a plain `ws` connection is sufficient here without another reconnect layer underneath it. If `@deepgram/sdk` is ever reintroduced, re-verify this exact failure doesn't recur before trusting it.

### Testing gotcha: fire-and-forget delivery means integration tests must poll, not sleep

`TranscriptionManager.handleResult` calls `onTranscriptEvent` synchronously and never awaits it (it's typed `() => void`) — production code deliberately doesn't block transcript handling on network I/O. That means any integration test asserting on the resulting Postgres row or Redis stream entry cannot know exactly when that fire-and-forget write lands. A fixed `setTimeout` before the assertion is a race (it passed on most machines/runs but occasionally read the assertion before the write completed — this actually happened and was fixed in `tests/integration/pipeline.integration.test.ts`). Poll for the actual data instead — see that file's `waitFor` helper — for any new integration test with the same shape.

### What's verified vs. unverified

**Verified with real audio and real infrastructure**: everything from `TranscriptionManager` downward — real Deepgram transcription, `TranscriptPipeline`, Postgres persistence, and Redis Stream publishing — via `scripts/live-audio-verification.ts` (`npm run verify:live-audio -- <audio-file>`), which found and fixed the `deepgramClient.ts` bug described above. This bypasses only the Zoom-specific bot-join layer.

**Still unverified**: Task 16 of the implementation plan (a live run against a real Zoom meeting) has never been performed, and currently cannot be — RTMS requires purchased Zoom "Developer Pack" credits and a paid host plan, unavailable on this account (Basic/free); see `ROADMAP.md`. `npm run dev` is confirmed to start successfully under WSL2 (Ubuntu) — `@zoom/rtms`'s native binding loads and the webhook HTTP server binds — but no real RTMS webhook has ever reached it. Treat anything touching live Zoom behavior (webhook payload shape, exact event-name string, `onJoinConfirm` reason-code semantics) as unconfirmed until that happens — see `docs/superpowers/notes/zoom-rtms-capability-findings.md`.
