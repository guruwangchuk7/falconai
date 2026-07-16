# Falcon Transcription Service

A Node.js/TypeScript service that joins a Zoom meeting as a bot via Zoom's Realtime Media Streams (RTMS), transcribes audio live via Deepgram, persists final transcript events to Postgres, and publishes every transcript event plus meeting-lifecycle events to a Redis Stream.

This is the meeting ingestion & transcription pipeline — the first building block of a larger planned system ("Falcon") where downstream AI consumers (a knowledge graph builder, per-role agents, a coordinator) will read from the Redis Stream this service produces. Those consumers are not part of this repo.

## Architecture

```
Zoom → ZoomBotAdapter → TranscriptionManager → TranscriptPipeline → Postgres
                                                                   → Redis Stream (public contract)
```

- **`ZoomBotAdapter`** — joins the meeting, emits a plain event surface (`meetingStarted`, `audioChunk`, `participantJoined/Left`, `meetingEnded`). The only module that knows Zoom-specific details.
- **`TranscriptionManager`** — routes audio to Deepgram, one session per participant (or one shared session with speaker diarization), and normalizes every timestamp to be relative to when the meeting started.
- **`TranscriptPipeline`** — persists final transcript events to Postgres, and publishes every event (interim + final) plus lifecycle events to Redis.

See `CLAUDE.md` for the full architectural detail, and `docs/superpowers/specs/` / `docs/superpowers/plans/` for the original design doc and implementation plan.

## Guide

### Prerequisites

- Node.js >= 20
- A local Postgres instance
- A local Redis instance
- Linux or macOS if you intend to actually run the server (`npm run dev`) — `@zoom/rtms` has no Windows build. On Windows you can still install, build, and run the full automated test suite; only the live server is blocked.

### Setup

```bash
git clone https://github.com/guruwangchuk7/falconai.git
cd falconai
npm install          # on Windows, use: npm install --force
cp .env.example .env
```

Fill in `.env`:

```
ZM_RTMS_CLIENT=              # Zoom Marketplace app client ID (only needed to run the real server)
ZM_RTMS_SECRET=              # Zoom Marketplace app client secret
ZOOM_WEBHOOK_SECRET_TOKEN=   # Zoom webhook secret token
DEEPGRAM_API_KEY=            # Deepgram API key
DATABASE_URL=postgres://localhost:5432/falcon_transcription
REDIS_URL=redis://localhost:6379
WEBHOOK_PORT=8080
```

Create the database and apply the schema:

```bash
createdb falcon_transcription
npm run migrate
```

### Running the tests

```bash
npm test                          # full suite: unit + integration + contract tests
npx vitest run tests/unit         # fast subset, no Postgres/Redis required
npx vitest run tests/integration  # requires DATABASE_URL/REDIS_URL reachable
npx vitest run path/to/one.test.ts
npm run build                     # type-check only (tsc), no emit-and-run
```

### Running the server

```bash
npm run dev
```

This joins Zoom meetings as they start (via the RTMS webhook), transcribes them, and streams events out. Requires:
- A Zoom Marketplace app with RTMS enabled, pointed at this service's webhook endpoint (`WEBHOOK_PORT`).
- A Deepgram API key.
- A Linux or macOS host.

### Consuming the output

Downstream consumers should read from the Redis Stream `meeting:{meetingId}:transcript` — this is the service's public contract. Each entry has two fields:

```
kind: "transcript" | "meeting_lifecycle"
payload: <JSON string>
```

`transcript` payloads match `TranscriptEvent` in `src/types/transcriptEvent.ts`; `meeting_lifecycle` payloads match `MeetingLifecycleEvent`. Only the Redis Stream and this wire format should be treated as stable — don't import from this project's internals to consume its output (see `tests/contract/redisStreamContract.test.ts`, which proves the stream is consumable with nothing but the `redis` package).

### Known limitations

- **Not yet verified against a real Zoom meeting.** The Zoom-specific wiring (`src/zoom/realRtmsClient.ts`, `src/zoom/realWebhookSource.ts`) has only been type-checked against the installed `@zoom/rtms` package, never executed against a live call. See `docs/superpowers/notes/zoom-rtms-capability-findings.md` for what's confirmed vs. still assumed.
- **Windows cannot run the real server.** `@zoom/rtms` ships no Windows binary.
- **Single meeting at a time.** The service is not designed for multiple concurrent meetings yet.
