# Meeting Ingestion & Transcription Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Join a real Zoom meeting as a bot, produce a speaker-attributed real-time transcript, persist it, and publish it to a Redis Stream that is Falcon's stable public contract for downstream AI consumers.

**Architecture:** A single Node.js/TypeScript service ("Falcon Transcription Service"), internally split into three modules — `ZoomBotAdapter` (Zoom RTMS bot join + audio capture), `TranscriptionManager` (capability-aware Deepgram STT), `TranscriptPipeline` (Postgres persistence + Redis Streams publish) — per `docs/superpowers/specs/2026-07-15-meeting-ingestion-transcription-pipeline-design.md`. Every module boundary is expressed as a narrow TypeScript interface so unit tests use fakes; only the composition root (Task 14) wires in the real `@zoom/rtms` and `@deepgram/sdk` packages.

**Tech Stack:** Node.js 20+, TypeScript 5, npm, Vitest (test runner), tsx (dev/script runner), `@zoom/rtms` (Zoom RTMS SDK), `@deepgram/sdk` (streaming STT), `pg` (Postgres), `redis` v4 (Redis Streams), `dotenv`.

## Global Constraints

- Node.js >= 20, TypeScript 5.x, npm as package manager (per Tech Stack above).
- Redis Stream key format: `meeting:{meetingId}:transcript` (spec, "The Redis Stream ... is this subsystem's public interface").
- `TranscriptEvent` fields and types are fixed by the spec's event contract (`version`, `utteranceId`, `meetingId`, `participantId`, `speakerName`, `text`, `isFinal`, `startTs`, `endTs`, `confidence`, `source: STTProvider`, `sequenceNumber`) — do not rename or drop fields.
- Only `isFinal: true` events are persisted to Postgres; every event (interim + final) is published to Redis (spec, `TranscriptPipeline`).
- Consumers must be able to treat events as at-least-once delivered and idempotent via `(meetingId, sequenceNumber)` — `sequenceNumber` must be assigned by a single component (`TranscriptPipeline`) and be monotonic per `meetingId`.
- Timestamps in every `TranscriptEvent` must be normalized relative to `meetingStarted`, not wall-clock/epoch time (spec, "Timestamp normalization").
- Out of scope: Google Meet/Teams support, multiple concurrent meetings, and any Knowledge Graph / agent / coordinator logic (spec, "Non-goals").
- **External prerequisites the engineer must have before starting:** a Zoom Marketplace app with RTMS enabled and a sandbox/test meeting account (needed for Task 1 and Task 16); a reachable local Postgres instance (`DATABASE_URL`) and Redis instance (`REDIS_URL`) for integration tests; a Deepgram API key (`DEEPGRAM_API_KEY`).
- Environment variables (see `.env.example`, created in Task 1): `ZM_RTMS_CLIENT`, `ZM_RTMS_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN`, `DEEPGRAM_API_KEY`, `DATABASE_URL`, `REDIS_URL`, `WEBHOOK_PORT`.

---

## Task 1: Project scaffolding + Zoom RTMS capability spike

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.gitignore`
- Create: `scripts/rtms-capability-check.ts`
- Create: `docs/superpowers/notes/zoom-rtms-capability-findings.md`

**Interfaces:**
- Produces: a working npm project (`npm test`, `npm run build` runnable), and a findings document that Tasks 10-13 depend on for the exact capability-detection logic in `TranscriptionManager`/`ZoomBotAdapter`.

This is the "Implementation prerequisite" spike called out explicitly in the spec. Research already confirmed (via Zoom's official docs/SDK type definitions) that the `@zoom/rtms` npm package exists, exposes `rtms.onWebhookEvent(({event, payload}) => ...)` for `meeting.rtms_started`/`meeting.rtms_stopped`, a `Client` class with `join()`/`leave()`/`setAudioParams()`, and callbacks `onAudioData(buffer, size, timestamp, metadata)`, `onActiveSpeakerEvent(timestamp, userId, userName)`, `onJoinConfirm(reason)`, `onLeave(reason)`. `AudioParams.dataOpt` defaults to `AUDIO_MULTI_STREAMS` (isolated per-participant audio), with `AUDIO_MIXED_STREAM` as the fallback mode. This spike verifies that against a real meeting before Tasks 10-13 are built on top of it.

- [ ] **Step 1: Initialize the npm project and install dependencies**

```bash
npm init -y
npm install @zoom/rtms @deepgram/sdk pg redis dotenv
npm install -D typescript vitest tsx @types/node @types/pg
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
  },
});
```

- [ ] **Step 4: Write `.env.example` and `.gitignore`**

`.env.example`:
```
ZM_RTMS_CLIENT=
ZM_RTMS_SECRET=
ZOOM_WEBHOOK_SECRET_TOKEN=
DEEPGRAM_API_KEY=
DATABASE_URL=postgres://localhost:5432/falcon_transcription
REDIS_URL=redis://localhost:6379
WEBHOOK_PORT=8080
```

`.gitignore`:
```
node_modules/
dist/
.env
```

- [ ] **Step 5: Add npm scripts to `package.json`**

Add under `"scripts"`:
```json
{
  "scripts": {
    "build": "tsc -p .",
    "test": "vitest run",
    "dev": "tsx src/server/index.ts",
    "migrate": "tsx src/db/runMigrate.ts",
    "spike:rtms": "tsx scripts/rtms-capability-check.ts"
  }
}
```

- [ ] **Step 6: Write the capability-check spike script**

```typescript
// scripts/rtms-capability-check.ts
import "dotenv/config";
import * as rtms from "@zoom/rtms";

console.log("Waiting for meeting.rtms_started webhook...");

rtms.onWebhookEvent(({ event, payload }) => {
  console.log("[webhook]", event, JSON.stringify(payload));
  if (event !== "meeting.rtms_started") return;

  const client = new rtms.Client();

  client.onJoinConfirm((reason) => {
    console.log("[onJoinConfirm] reason=", reason);
  });

  client.onAudioData((buffer, size, timestamp, metadata) => {
    console.log(
      "[onAudioData] size=",
      size,
      "timestamp=",
      timestamp,
      "metadata=",
      JSON.stringify(metadata)
    );
  });

  client.onActiveSpeakerEvent((timestamp, userId, userName) => {
    console.log("[onActiveSpeakerEvent]", timestamp, userId, userName);
  });

  client.onLeave((reason) => {
    console.log("[onLeave] reason=", reason);
  });

  client.join(payload);
});
```

- [ ] **Step 7: Run the spike against a real Zoom sandbox meeting**

Run: `npm run spike:rtms`, then start a Zoom meeting in the sandbox account with RTMS enabled and speak as at least two participants.

Expected: console output showing `[webhook] meeting.rtms_started ...`, followed by repeated `[onAudioData] ...` lines. Record in the findings doc (Step 8):
- Whether `metadata` on `onAudioData` contains a stable per-participant identifier (e.g. `userId`/`userName`) for each of the two speakers separately, confirming `AUDIO_MULTI_STREAMS` gives isolated per-participant audio.
- Whether the `meeting.rtms_started` webhook payload includes an initial participant roster, and its exact shape.
- Whether `[onActiveSpeakerEvent]` fires reliably as speakers change (needed for the diarized-mode fallback).
- The actual `reason` codes seen from `onJoinConfirm`/`onLeave` for normal vs. abnormal termination.

- [ ] **Step 8: Write the findings doc**

```markdown
<!-- docs/superpowers/notes/zoom-rtms-capability-findings.md -->
# Zoom RTMS Capability Findings

Date: <fill in when run>

## Per-participant audio
<Record what metadata.userId/userName looked like for each speaker, confirming isolation>

## meeting.rtms_started payload shape
<Paste the actual JSON observed>

## Active speaker events
<Record observed cadence/reliability>

## Join/leave reason codes
<Record observed values for normal vs. abnormal termination>
```

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example .gitignore scripts/rtms-capability-check.ts docs/superpowers/notes/zoom-rtms-capability-findings.md
git commit -m "Scaffold project and run Zoom RTMS capability spike"
```

---

## Task 2: Shared event types + timestamp normalizer

**Files:**
- Create: `src/types/transcriptEvent.ts`
- Create: `src/lib/timestampNormalizer.ts`
- Test: `tests/unit/timestampNormalizer.test.ts`

**Interfaces:**
- Produces: `TranscriptEvent`, `MeetingLifecycleEvent`, `STTProvider` types (consumed by every later task) and `normalizeTimestamp(rawTimestampMs, meetingStartedAtMs): number`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/timestampNormalizer.test.ts
import { describe, it, expect } from "vitest";
import { normalizeTimestamp } from "../../src/lib/timestampNormalizer";

describe("normalizeTimestamp", () => {
  it("returns elapsed ms from meeting start", () => {
    expect(normalizeTimestamp(1_700_000_005_000, 1_700_000_000_000)).toBe(5000);
  });

  it("throws when timestamp precedes meeting start", () => {
    expect(() =>
      normalizeTimestamp(1_699_999_999_000, 1_700_000_000_000)
    ).toThrow("timestamp precedes meetingStartedAt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/timestampNormalizer.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/timestampNormalizer'"

- [ ] **Step 3: Write the types file and the implementation**

```typescript
// src/types/transcriptEvent.ts
export type STTProvider = "deepgram" | "assemblyai" | "whisper";

export interface TranscriptEvent {
  version: 1;
  utteranceId: string;
  meetingId: string;
  participantId: string;
  speakerName: string;
  text: string;
  isFinal: boolean;
  startTs: number;
  endTs: number;
  confidence: number;
  source: STTProvider;
  sequenceNumber: number;
}

export interface Participant {
  participantId: string;
  displayName: string;
}

export interface MeetingLifecycleEvent {
  type: "meeting_lifecycle";
  meetingId: string;
  status: "started" | "ended" | "ended_error";
  timestamp: number;
  participants?: Participant[];
}
```

```typescript
// src/lib/timestampNormalizer.ts
export function normalizeTimestamp(
  rawTimestampMs: number,
  meetingStartedAtMs: number
): number {
  const elapsed = rawTimestampMs - meetingStartedAtMs;
  if (elapsed < 0) {
    throw new Error("timestamp precedes meetingStartedAt");
  }
  return elapsed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/timestampNormalizer.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/types/transcriptEvent.ts src/lib/timestampNormalizer.ts tests/unit/timestampNormalizer.test.ts
git commit -m "Add shared event types and timestamp normalizer"
```

---

## Task 3: Postgres schema, connection pool, migration runner

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/pool.ts`
- Create: `src/db/migrate.ts`
- Create: `src/db/runMigrate.ts`
- Test: `tests/integration/db.integration.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` env var.
- Produces: `getPool(): Pool`, `closePool(): Promise<void>`, `migrate(): Promise<void>` (consumed by Task 6's `PostgresTranscriptStore` and this task's own test).

Requires a reachable local Postgres for `DATABASE_URL` (Global Constraints).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/db.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";

describe("database schema", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it("allows inserting and reading a meeting row", async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO meetings (meeting_id, started_at, status) VALUES ($1, now(), 'active')
       ON CONFLICT (meeting_id) DO NOTHING`,
      ["test-meeting-1"]
    );
    const { rows } = await pool.query(
      "SELECT status FROM meetings WHERE meeting_id = $1",
      ["test-meeting-1"]
    );
    expect(rows[0].status).toBe("active");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/db.integration.test.ts`
Expected: FAIL with "Cannot find module '../../src/db/migrate'"

- [ ] **Step 3: Write the schema, pool, and migration runner**

```sql
-- src/db/schema.sql
CREATE TABLE IF NOT EXISTS meetings (
  meeting_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS transcript_events (
  id BIGSERIAL PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(meeting_id),
  utterance_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  speaker_name TEXT NOT NULL,
  text TEXT NOT NULL,
  start_ts BIGINT NOT NULL,
  end_ts BIGINT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  sequence_number BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_transcript_events_meeting
  ON transcript_events (meeting_id, sequence_number);
```

```typescript
// src/db/pool.ts
import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
```

```typescript
// src/db/migrate.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./pool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(): Promise<void> {
  const sql = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await getPool().query(sql);
}
```

```typescript
// src/db/runMigrate.ts
import "dotenv/config";
import { migrate } from "./migrate";
import { closePool } from "./pool";

migrate()
  .then(async () => {
    console.log("migration complete");
    await closePool();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://localhost:5432/falcon_transcription npx vitest run tests/integration/db.integration.test.ts`
Expected: PASS (1 test) — create the `falcon_transcription` database first if it doesn't exist (`createdb falcon_transcription`).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.sql src/db/pool.ts src/db/migrate.ts src/db/runMigrate.ts tests/integration/db.integration.test.ts
git commit -m "Add Postgres schema, pool, and migration runner"
```

---

## Task 4: Redis client + SequenceNumberAllocator

**Files:**
- Create: `src/redis/client.ts`
- Create: `src/pipeline/sequenceNumberAllocator.ts`
- Test: `tests/integration/sequenceNumberAllocator.integration.test.ts`

**Interfaces:**
- Consumes: `REDIS_URL` env var.
- Produces: `getRedisClient(): Promise<RedisClientType>`, `closeRedisClient(): Promise<void>`, `SequenceNumberAllocator.next(meetingId: string): Promise<number>` (consumed by Task 7's `TranscriptPipeline`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/sequenceNumberAllocator.integration.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { SequenceNumberAllocator } from "../../src/pipeline/sequenceNumberAllocator";
import { closeRedisClient, getRedisClient } from "../../src/redis/client";

describe("SequenceNumberAllocator", () => {
  afterAll(async () => {
    await closeRedisClient();
  });

  it("returns increasing numbers per meeting, independent across meetings", async () => {
    const allocator = new SequenceNumberAllocator();
    const client = await getRedisClient();
    await client.del("meeting:seq-test-a:seq");
    await client.del("meeting:seq-test-b:seq");

    expect(await allocator.next("seq-test-a")).toBe(1);
    expect(await allocator.next("seq-test-a")).toBe(2);
    expect(await allocator.next("seq-test-b")).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/sequenceNumberAllocator.integration.test.ts`
Expected: FAIL with "Cannot find module '../../src/pipeline/sequenceNumberAllocator'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/redis/client.ts
import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | undefined;

export async function getRedisClient(): Promise<RedisClientType> {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => console.error("Redis client error", err));
    await client.connect();
  }
  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
```

```typescript
// src/pipeline/sequenceNumberAllocator.ts
import { getRedisClient } from "../redis/client";

export class SequenceNumberAllocator {
  async next(meetingId: string): Promise<number> {
    const client = await getRedisClient();
    return client.incr(`meeting:${meetingId}:seq`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `REDIS_URL=redis://localhost:6379 npx vitest run tests/integration/sequenceNumberAllocator.integration.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/redis/client.ts src/pipeline/sequenceNumberAllocator.ts tests/integration/sequenceNumberAllocator.integration.test.ts
git commit -m "Add Redis client and per-meeting sequence number allocator"
```

---

## Task 5: RedisTranscriptPublisher

**Files:**
- Create: `src/pipeline/redisTranscriptPublisher.ts`
- Test: `tests/integration/redisTranscriptPublisher.integration.test.ts`

**Interfaces:**
- Consumes: `getRedisClient` (Task 4), `TranscriptEvent`/`MeetingLifecycleEvent` (Task 2).
- Produces: `RedisTranscriptPublisher.publishTranscript(event: TranscriptEvent): Promise<void>`, `.publishLifecycle(event: MeetingLifecycleEvent): Promise<void>` (consumed by Task 7's `TranscriptPipeline`). Wire format: Redis Stream entry with fields `{ kind: "transcript" | "meeting_lifecycle", payload: <JSON string> }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/redisTranscriptPublisher.integration.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { RedisTranscriptPublisher } from "../../src/pipeline/redisTranscriptPublisher";
import { closeRedisClient, getRedisClient } from "../../src/redis/client";
import type { TranscriptEvent } from "../../src/types/transcriptEvent";

describe("RedisTranscriptPublisher", () => {
  afterAll(async () => {
    await closeRedisClient();
  });

  it("publishes a transcript event onto the meeting's stream", async () => {
    const client = await getRedisClient();
    await client.del("meeting:pub-test-1:transcript");

    const publisher = new RedisTranscriptPublisher();
    const event: TranscriptEvent = {
      version: 1,
      utteranceId: "utt-1",
      meetingId: "pub-test-1",
      participantId: "p1",
      speakerName: "Alex",
      text: "hello",
      isFinal: true,
      startTs: 0,
      endTs: 500,
      confidence: 0.95,
      source: "deepgram",
      sequenceNumber: 1,
    };
    await publisher.publishTranscript(event);

    const entries = await client.xRange("meeting:pub-test-1:transcript", "-", "+");
    expect(entries).toHaveLength(1);
    expect(entries[0].message.kind).toBe("transcript");
    expect(JSON.parse(entries[0].message.payload)).toEqual(event);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/redisTranscriptPublisher.integration.test.ts`
Expected: FAIL with "Cannot find module '../../src/pipeline/redisTranscriptPublisher'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/pipeline/redisTranscriptPublisher.ts
import { getRedisClient } from "../redis/client";
import type { TranscriptEvent, MeetingLifecycleEvent } from "../types/transcriptEvent";

export class RedisTranscriptPublisher {
  async publishTranscript(event: TranscriptEvent): Promise<void> {
    const client = await getRedisClient();
    await client.xAdd(`meeting:${event.meetingId}:transcript`, "*", {
      kind: "transcript",
      payload: JSON.stringify(event),
    });
  }

  async publishLifecycle(event: MeetingLifecycleEvent): Promise<void> {
    const client = await getRedisClient();
    await client.xAdd(`meeting:${event.meetingId}:transcript`, "*", {
      kind: "meeting_lifecycle",
      payload: JSON.stringify(event),
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `REDIS_URL=redis://localhost:6379 npx vitest run tests/integration/redisTranscriptPublisher.integration.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/redisTranscriptPublisher.ts tests/integration/redisTranscriptPublisher.integration.test.ts
git commit -m "Add RedisTranscriptPublisher"
```

---

## Task 6: PostgresTranscriptStore

**Files:**
- Create: `src/pipeline/postgresTranscriptStore.ts`
- Test: `tests/integration/postgresTranscriptStore.integration.test.ts`

**Interfaces:**
- Consumes: `getPool` (Task 3), `TranscriptEvent` (Task 2).
- Produces: `PostgresTranscriptStore.openMeeting(meetingId)`, `.closeMeeting(meetingId, status)`, `.saveFinalEvent(event)` (consumed by Task 7's `TranscriptPipeline`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/postgresTranscriptStore.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { PostgresTranscriptStore } from "../../src/pipeline/postgresTranscriptStore";
import type { TranscriptEvent } from "../../src/types/transcriptEvent";

describe("PostgresTranscriptStore", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it("opens a meeting, saves a final event, and closes the meeting", async () => {
    const store = new PostgresTranscriptStore();
    await store.openMeeting("pg-store-test-1");

    const event: TranscriptEvent = {
      version: 1,
      utteranceId: "utt-1",
      meetingId: "pg-store-test-1",
      participantId: "p1",
      speakerName: "Alex",
      text: "hello",
      isFinal: true,
      startTs: 0,
      endTs: 500,
      confidence: 0.95,
      source: "deepgram",
      sequenceNumber: 1,
    };
    await store.saveFinalEvent(event);
    await store.closeMeeting("pg-store-test-1", "ended");

    const pool = getPool();
    const { rows: meetingRows } = await pool.query(
      "SELECT status FROM meetings WHERE meeting_id = $1",
      ["pg-store-test-1"]
    );
    expect(meetingRows[0].status).toBe("ended");

    const { rows: eventRows } = await pool.query(
      "SELECT text, sequence_number FROM transcript_events WHERE meeting_id = $1",
      ["pg-store-test-1"]
    );
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0].text).toBe("hello");
  });

  it("rejects interim (non-final) events", async () => {
    const store = new PostgresTranscriptStore();
    const interim: TranscriptEvent = {
      version: 1,
      utteranceId: "utt-2",
      meetingId: "pg-store-test-1",
      participantId: "p1",
      speakerName: "Alex",
      text: "hel",
      isFinal: false,
      startTs: 0,
      endTs: 200,
      confidence: 0.5,
      source: "deepgram",
      sequenceNumber: 2,
    };
    await expect(store.saveFinalEvent(interim)).rejects.toThrow(
      "PostgresTranscriptStore only persists final events"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/postgresTranscriptStore.integration.test.ts`
Expected: FAIL with "Cannot find module '../../src/pipeline/postgresTranscriptStore'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/pipeline/postgresTranscriptStore.ts
import { getPool } from "../db/pool";
import type { TranscriptEvent } from "../types/transcriptEvent";

export class PostgresTranscriptStore {
  async openMeeting(meetingId: string): Promise<void> {
    await getPool().query(
      `INSERT INTO meetings (meeting_id, started_at, status) VALUES ($1, now(), 'active')
       ON CONFLICT (meeting_id) DO NOTHING`,
      [meetingId]
    );
  }

  async closeMeeting(
    meetingId: string,
    status: "ended" | "ended_error"
  ): Promise<void> {
    await getPool().query(
      `UPDATE meetings SET ended_at = now(), status = $2 WHERE meeting_id = $1`,
      [meetingId, status]
    );
  }

  async saveFinalEvent(event: TranscriptEvent): Promise<void> {
    if (!event.isFinal) {
      throw new Error("PostgresTranscriptStore only persists final events");
    }
    await getPool().query(
      `INSERT INTO transcript_events
        (meeting_id, utterance_id, participant_id, speaker_name, text, start_ts, end_ts, confidence, source, sequence_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (meeting_id, sequence_number) DO NOTHING`,
      [
        event.meetingId,
        event.utteranceId,
        event.participantId,
        event.speakerName,
        event.text,
        event.startTs,
        event.endTs,
        event.confidence,
        event.source,
        event.sequenceNumber,
      ]
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://localhost:5432/falcon_transcription npx vitest run tests/integration/postgresTranscriptStore.integration.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/postgresTranscriptStore.ts tests/integration/postgresTranscriptStore.integration.test.ts
git commit -m "Add PostgresTranscriptStore"
```

---

## Task 7: Retry helper + TranscriptPipeline composition

**Files:**
- Create: `src/lib/retry.ts`
- Create: `src/pipeline/transcriptPipeline.ts`
- Test: `tests/unit/transcriptPipeline.test.ts`

**Interfaces:**
- Consumes: `TranscriptStoreLike`, `TranscriptPublisherLike`, `SequenceAllocatorLike` — narrow interfaces matched by Tasks 4-6's real classes.
- Produces: `TranscriptPipeline.handleMeetingStarted(meetingId, timestamp, participants)`, `.handleMeetingEnded(meetingId, timestamp, status)`, `.handleTranscriptEvent(partial: Omit<TranscriptEvent, "sequenceNumber">): Promise<void>` (consumed by Task 14's server wiring).

This implements the spec's failure semantics: Postgres failures are retried then logged (delivery continues); Redis failures are retried more aggressively and escalate.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/transcriptPipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { TranscriptPipeline } from "../../src/pipeline/transcriptPipeline";

function makeDeps(overrides: Partial<Parameters<typeof TranscriptPipeline.prototype.constructor>[0]> = {}) {
  return {
    store: {
      openMeeting: vi.fn().mockResolvedValue(undefined),
      closeMeeting: vi.fn().mockResolvedValue(undefined),
      saveFinalEvent: vi.fn().mockResolvedValue(undefined),
    },
    publisher: {
      publishTranscript: vi.fn().mockResolvedValue(undefined),
      publishLifecycle: vi.fn().mockResolvedValue(undefined),
    },
    allocator: { next: vi.fn().mockResolvedValue(1) },
    onAlert: vi.fn(),
    postgresRetry: { retries: 2, baseDelayMs: 1 },
    redisRetry: { retries: 2, baseDelayMs: 1 },
    ...overrides,
  };
}

describe("TranscriptPipeline", () => {
  it("opens the meeting then publishes a started lifecycle event", async () => {
    const deps = makeDeps();
    const pipeline = new TranscriptPipeline(deps as any);

    await pipeline.handleMeetingStarted("m1", 1000, [
      { participantId: "p1", displayName: "Alex" },
    ]);

    expect(deps.store.openMeeting).toHaveBeenCalledWith("m1");
    expect(deps.publisher.publishLifecycle).toHaveBeenCalledWith({
      type: "meeting_lifecycle",
      meetingId: "m1",
      status: "started",
      timestamp: 1000,
      participants: [{ participantId: "p1", displayName: "Alex" }],
    });
  });

  it("assigns a sequence number, persists final events, and always publishes", async () => {
    const deps = makeDeps();
    const pipeline = new TranscriptPipeline(deps as any);

    await pipeline.handleTranscriptEvent({
      version: 1,
      utteranceId: "u1",
      meetingId: "m1",
      participantId: "p1",
      speakerName: "Alex",
      text: "hi",
      isFinal: true,
      startTs: 0,
      endTs: 100,
      confidence: 0.9,
      source: "deepgram",
    });

    expect(deps.store.saveFinalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sequenceNumber: 1 })
    );
    expect(deps.publisher.publishTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ sequenceNumber: 1 })
    );
  });

  it("does not persist interim events but still publishes them", async () => {
    const deps = makeDeps();
    const pipeline = new TranscriptPipeline(deps as any);

    await pipeline.handleTranscriptEvent({
      version: 1,
      utteranceId: "u1",
      meetingId: "m1",
      participantId: "p1",
      speakerName: "Alex",
      text: "h",
      isFinal: false,
      startTs: 0,
      endTs: 50,
      confidence: 0.4,
      source: "deepgram",
    });

    expect(deps.store.saveFinalEvent).not.toHaveBeenCalled();
    expect(deps.publisher.publishTranscript).toHaveBeenCalled();
  });

  it("alerts but keeps delivering live when Postgres persistence fails", async () => {
    const deps = makeDeps({
      store: {
        openMeeting: vi.fn().mockResolvedValue(undefined),
        closeMeeting: vi.fn().mockResolvedValue(undefined),
        saveFinalEvent: vi.fn().mockRejectedValue(new Error("db down")),
      },
    });
    const pipeline = new TranscriptPipeline(deps as any);

    await pipeline.handleTranscriptEvent({
      version: 1,
      utteranceId: "u1",
      meetingId: "m1",
      participantId: "p1",
      speakerName: "Alex",
      text: "hi",
      isFinal: true,
      startTs: 0,
      endTs: 100,
      confidence: 0.9,
      source: "deepgram",
    });

    expect(deps.onAlert).toHaveBeenCalledWith(
      expect.stringContaining("postgres persistence failed"),
      expect.any(Error)
    );
    expect(deps.publisher.publishTranscript).toHaveBeenCalled();
  });

  it("alerts and rethrows when Redis publishing fails after retries", async () => {
    const deps = makeDeps({
      publisher: {
        publishTranscript: vi.fn().mockRejectedValue(new Error("redis down")),
        publishLifecycle: vi.fn().mockResolvedValue(undefined),
      },
    });
    const pipeline = new TranscriptPipeline(deps as any);

    await expect(
      pipeline.handleTranscriptEvent({
        version: 1,
        utteranceId: "u1",
        meetingId: "m1",
        participantId: "p1",
        speakerName: "Alex",
        text: "hi",
        isFinal: true,
        startTs: 0,
        endTs: 100,
        confidence: 0.9,
        source: "deepgram",
      })
    ).rejects.toThrow("redis down");

    expect(deps.onAlert).toHaveBeenCalledWith(
      expect.stringContaining("redis publish failed"),
      expect.any(Error)
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/transcriptPipeline.test.ts`
Expected: FAIL with "Cannot find module '../../src/pipeline/transcriptPipeline'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/retry.ts
export interface RetryConfig {
  retries: number;
  baseDelayMs: number;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms))
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < config.retries) {
        await sleep(config.baseDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}
```

```typescript
// src/pipeline/transcriptPipeline.ts
import type {
  TranscriptEvent,
  MeetingLifecycleEvent,
  Participant,
} from "../types/transcriptEvent";
import { retryWithBackoff, type RetryConfig } from "../lib/retry";

export interface TranscriptStoreLike {
  openMeeting(meetingId: string): Promise<void>;
  closeMeeting(meetingId: string, status: "ended" | "ended_error"): Promise<void>;
  saveFinalEvent(event: TranscriptEvent): Promise<void>;
}

export interface TranscriptPublisherLike {
  publishTranscript(event: TranscriptEvent): Promise<void>;
  publishLifecycle(event: MeetingLifecycleEvent): Promise<void>;
}

export interface SequenceAllocatorLike {
  next(meetingId: string): Promise<number>;
}

export interface TranscriptPipelineDeps {
  store: TranscriptStoreLike;
  publisher: TranscriptPublisherLike;
  allocator: SequenceAllocatorLike;
  onAlert: (message: string, err: unknown) => void;
  postgresRetry?: RetryConfig;
  redisRetry?: RetryConfig;
}

const DEFAULT_POSTGRES_RETRY: RetryConfig = { retries: 3, baseDelayMs: 200 };
const DEFAULT_REDIS_RETRY: RetryConfig = { retries: 5, baseDelayMs: 100 };

export class TranscriptPipeline {
  private readonly postgresRetry: RetryConfig;
  private readonly redisRetry: RetryConfig;

  constructor(private readonly deps: TranscriptPipelineDeps) {
    this.postgresRetry = deps.postgresRetry ?? DEFAULT_POSTGRES_RETRY;
    this.redisRetry = deps.redisRetry ?? DEFAULT_REDIS_RETRY;
  }

  async handleMeetingStarted(
    meetingId: string,
    timestamp: number,
    participants: Participant[]
  ): Promise<void> {
    await this.deps.store.openMeeting(meetingId);
    await this.publishLifecycleWithRetry({
      type: "meeting_lifecycle",
      meetingId,
      status: "started",
      timestamp,
      participants,
    });
  }

  async handleMeetingEnded(
    meetingId: string,
    timestamp: number,
    status: "ended" | "ended_error"
  ): Promise<void> {
    await this.deps.store.closeMeeting(meetingId, status);
    await this.publishLifecycleWithRetry({
      type: "meeting_lifecycle",
      meetingId,
      status,
      timestamp,
    });
  }

  async handleTranscriptEvent(
    partial: Omit<TranscriptEvent, "sequenceNumber">
  ): Promise<void> {
    const sequenceNumber = await this.deps.allocator.next(partial.meetingId);
    const event: TranscriptEvent = { ...partial, sequenceNumber };

    if (event.isFinal) {
      try {
        await retryWithBackoff(
          () => this.deps.store.saveFinalEvent(event),
          this.postgresRetry
        );
      } catch (err) {
        this.deps.onAlert(
          "postgres persistence failed after retries, continuing live delivery",
          err
        );
      }
    }

    await retryWithBackoff(
      () => this.deps.publisher.publishTranscript(event),
      this.redisRetry
    ).catch((err) => {
      this.deps.onAlert("redis publish failed after retries", err);
      throw err;
    });
  }

  private async publishLifecycleWithRetry(
    event: MeetingLifecycleEvent
  ): Promise<void> {
    await retryWithBackoff(
      () => this.deps.publisher.publishLifecycle(event),
      this.redisRetry
    ).catch((err) => {
      this.deps.onAlert("redis publish failed after retries", err);
      throw err;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/transcriptPipeline.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/retry.ts src/pipeline/transcriptPipeline.ts tests/unit/transcriptPipeline.test.ts
git commit -m "Add retry helper and TranscriptPipeline composition"
```

---

## Task 8: Deepgram STT session abstraction

**Files:**
- Create: `src/transcription/deepgramLiveConnection.types.ts`
- Create: `src/transcription/sttSession.ts`
- Create: `src/transcription/deepgramClient.ts`
- Test: `tests/unit/sttSession.test.ts`

**Interfaces:**
- Produces: `DeepgramLiveConnectionLike` (narrow interface), `SttSession.start(connection, handlers)`, `.send(buffer)`, `.close()`, and `createDeepgramSession(apiKey, opts): DeepgramLiveConnectionLike` (real adapter, consumed by Task 10's `TranscriptionManager` and Task 14's server wiring).

`SttSession` is unit-tested against a fake `DeepgramLiveConnectionLike`; `deepgramClient.ts`'s real wiring is exercised only in the Task 16 manual/live test, since it requires a live Deepgram connection.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/sttSession.test.ts
import { describe, it, expect, vi } from "vitest";
import { SttSession } from "../../src/transcription/sttSession";
import type { DeepgramLiveConnectionLike } from "../../src/transcription/deepgramLiveConnection.types";

function makeFakeConnection() {
  const handlers: Record<string, Function> = {};
  const connection: DeepgramLiveConnectionLike = {
    onTranscript: (cb) => (handlers.transcript = cb),
    onError: (cb) => (handlers.error = cb),
    onClose: (cb) => (handlers.close = cb),
    send: vi.fn(),
    finish: vi.fn(),
  };
  return { connection, handlers };
}

describe("SttSession", () => {
  it("forwards transcript, error, and close events to the provided handlers", () => {
    const { connection, handlers } = makeFakeConnection();
    const onResult = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();

    SttSession.start(connection, { onResult, onError, onClose });

    const payload = {
      text: "hello",
      isFinal: true,
      durationMs: 500,
      confidence: 0.9,
    };
    handlers.transcript(payload);
    expect(onResult).toHaveBeenCalledWith(payload);

    const err = new Error("boom");
    handlers.error(err);
    expect(onError).toHaveBeenCalledWith(err);

    handlers.close();
    expect(onClose).toHaveBeenCalled();
  });

  it("sends audio buffers and closes the underlying connection", () => {
    const { connection } = makeFakeConnection();
    const session = SttSession.start(connection, {
      onResult: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    });

    const buf = Buffer.from([1, 2, 3]);
    session.send(buf);
    expect(connection.send).toHaveBeenCalledWith(buf);

    session.close();
    expect(connection.finish).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sttSession.test.ts`
Expected: FAIL with "Cannot find module '../../src/transcription/sttSession'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/transcription/deepgramLiveConnection.types.ts
export interface DeepgramTranscriptPayload {
  text: string;
  isFinal: boolean;
  durationMs: number; // duration of this utterance segment; Deepgram's own start/duration
                       // are relative to when its connection opened, not the meeting timeline,
                       // so TranscriptionManager derives meeting-relative startTs/endTs itself
  confidence: number;
  speakerLabel?: string;
}

export interface DeepgramLiveConnectionLike {
  onTranscript(cb: (payload: DeepgramTranscriptPayload) => void): void;
  onError(cb: (err: Error) => void): void;
  onClose(cb: () => void): void;
  send(buffer: Buffer): void;
  finish(): void;
}
```

```typescript
// src/transcription/sttSession.ts
import type {
  DeepgramLiveConnectionLike,
  DeepgramTranscriptPayload,
} from "./deepgramLiveConnection.types";

export interface SttSessionHandlers {
  onResult: (payload: DeepgramTranscriptPayload) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

export class SttSession {
  private constructor(private readonly connection: DeepgramLiveConnectionLike) {}

  static start(
    connection: DeepgramLiveConnectionLike,
    handlers: SttSessionHandlers
  ): SttSession {
    connection.onTranscript(handlers.onResult);
    connection.onError(handlers.onError);
    connection.onClose(handlers.onClose);
    return new SttSession(connection);
  }

  send(buffer: Buffer): void {
    this.connection.send(buffer);
  }

  close(): void {
    this.connection.finish();
  }
}
```

```typescript
// src/transcription/deepgramClient.ts
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import type { DeepgramLiveConnectionLike } from "./deepgramLiveConnection.types";

export function createDeepgramSession(
  apiKey: string,
  opts: { diarize: boolean }
): DeepgramLiveConnectionLike {
  const deepgram = createClient(apiKey);
  const live = deepgram.listen.live({
    model: "nova-2",
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
    smart_format: true,
    interim_results: true,
    diarize: opts.diarize,
  });

  return {
    onTranscript(cb) {
      live.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        const alt = data.channel.alternatives[0];
        cb({
          text: alt.transcript,
          isFinal: Boolean(data.is_final),
          durationMs: data.duration * 1000,
          confidence: alt.confidence,
          speakerLabel:
            alt.words?.[0]?.speaker !== undefined
              ? String(alt.words[0].speaker)
              : undefined,
        });
      });
    },
    onError(cb) {
      live.on(LiveTranscriptionEvents.Error, cb);
    },
    onClose(cb) {
      live.on(LiveTranscriptionEvents.Close, cb);
    },
    send(buffer) {
      live.send(buffer);
    },
    finish() {
      live.finish();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sttSession.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/transcription/deepgramLiveConnection.types.ts src/transcription/sttSession.ts src/transcription/deepgramClient.ts tests/unit/sttSession.test.ts
git commit -m "Add Deepgram STT session abstraction"
```

---

## Task 9: ActiveSpeakerTimeline (diarized-mode speaker resolution)

**Files:**
- Create: `src/transcription/activeSpeakerTimeline.ts`
- Test: `tests/unit/activeSpeakerTimeline.test.ts`

**Interfaces:**
- Produces: `ActiveSpeakerTimeline.recordActiveSpeaker(participantId, atTs)`, `.resolveParticipant(startTs, endTs): string | undefined` (consumed by Task 10's `TranscriptionManager` in diarized mode, per spec: "maps diarized labels to participant identities using Zoom's ... active-speaker signals").

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/activeSpeakerTimeline.test.ts
import { describe, it, expect } from "vitest";
import { ActiveSpeakerTimeline } from "../../src/transcription/activeSpeakerTimeline";

describe("ActiveSpeakerTimeline", () => {
  it("resolves a segment to the participant active during that window", () => {
    const timeline = new ActiveSpeakerTimeline();
    timeline.recordActiveSpeaker("p1", 0);
    timeline.recordActiveSpeaker("p2", 1000);

    expect(timeline.resolveParticipant(0, 900)).toBe("p1");
    expect(timeline.resolveParticipant(1000, 1500)).toBe("p2");
  });

  it("picks the participant with the largest overlap for a segment spanning a speaker change", () => {
    const timeline = new ActiveSpeakerTimeline();
    timeline.recordActiveSpeaker("p1", 0);
    timeline.recordActiveSpeaker("p2", 900);
    timeline.recordActiveSpeaker("p2", 1500);

    expect(timeline.resolveParticipant(0, 1000)).toBe("p1");
  });

  it("returns undefined when no window overlaps the segment", () => {
    const timeline = new ActiveSpeakerTimeline();
    timeline.recordActiveSpeaker("p1", 5000);

    expect(timeline.resolveParticipant(0, 100)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/activeSpeakerTimeline.test.ts`
Expected: FAIL with "Cannot find module '../../src/transcription/activeSpeakerTimeline'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/transcription/activeSpeakerTimeline.ts
interface SpeakerWindow {
  participantId: string;
  startTs: number;
  endTs: number;
}

export class ActiveSpeakerTimeline {
  private windows: SpeakerWindow[] = [];

  recordActiveSpeaker(participantId: string, atTs: number): void {
    const last = this.windows[this.windows.length - 1];
    if (last) {
      last.endTs = atTs;
      if (last.participantId === participantId) {
        // Same speaker again: keep their window open (see below), nothing else to do.
        last.endTs = Infinity;
        return;
      }
    }
    // The newly active speaker's window stays open (endTs = Infinity) until
    // the next recordActiveSpeaker call closes it out — they're presumed to
    // still be speaking until we hear otherwise.
    this.windows.push({ participantId, startTs: atTs, endTs: Infinity });
  }

  resolveParticipant(startTs: number, endTs: number): string | undefined {
    let best: { participantId: string; overlap: number } | undefined;
    for (const w of this.windows) {
      const windowEnd = w.endTs === Infinity ? endTs : w.endTs;
      const overlap = Math.min(endTs, windowEnd) - Math.max(startTs, w.startTs);
      if (overlap > 0 && (!best || overlap > best.overlap)) {
        best = { participantId: w.participantId, overlap };
      }
    }
    return best?.participantId;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/activeSpeakerTimeline.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/transcription/activeSpeakerTimeline.ts tests/unit/activeSpeakerTimeline.test.ts
git commit -m "Add ActiveSpeakerTimeline for diarized-mode speaker resolution"
```

---

## Task 10: TranscriptionManager — session management (per-participant & diarized modes)

**Files:**
- Create: `src/transcription/transcriptionManager.ts`
- Test: `tests/unit/transcriptionManager.test.ts`

**Interfaces:**
- Consumes: `DeepgramLiveConnectionLike` (Task 8), `ActiveSpeakerTimeline` (Task 9), `normalizeTimestamp` (Task 2).
- Produces: `TranscriptionManager.handleAudioChunk(participantId, buffer, timestamp)`, `.handleActiveSpeaker(participantId, timestamp)`, `.handleParticipantLeft(participantId)`, `.checkInactivity(now)`, event `"transcriptEvent"` emitting `Omit<TranscriptEvent, "sequenceNumber" | "meetingId">` (consumed by Task 14's server wiring, which adds `meetingId` before calling `TranscriptPipeline.handleTranscriptEvent`).

This task covers session creation/routing/inactivity-close only; reconnect-with-buffering on a dropped session is Task 11.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/transcriptionManager.test.ts
import { describe, it, expect, vi } from "vitest";
import { TranscriptionManager } from "../../src/transcription/transcriptionManager";
import type { DeepgramLiveConnectionLike } from "../../src/transcription/deepgramLiveConnection.types";

function makeFakeSession() {
  const handlers: Record<string, Function> = {};
  const send = vi.fn();
  const finish = vi.fn();
  const connection: DeepgramLiveConnectionLike = {
    onTranscript: (cb) => (handlers.transcript = cb),
    onError: (cb) => (handlers.error = cb),
    onClose: (cb) => (handlers.close = cb),
    send,
    finish,
  };
  return { connection, handlers, send, finish };
}

describe("TranscriptionManager (per-participant mode)", () => {
  it("opens one Deepgram session per participant and normalizes results", () => {
    const sessions: Record<string, ReturnType<typeof makeFakeSession>> = {};
    const createSession = vi.fn((opts: { diarize: boolean }) => {
      const s = makeFakeSession();
      sessions[Object.keys(sessions).length === 0 ? "p1" : "p2"] = s;
      return s.connection;
    });
    const onTranscriptEvent = vi.fn();
    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 1000,
      onTranscriptEvent,
      now: () => 1000,
    });

    manager.handleAudioChunk("p1", Buffer.from([1]), 1500);
    manager.handleAudioChunk("p2", Buffer.from([2]), 1600);

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(sessions.p1.send).toHaveBeenCalledWith(Buffer.from([1]));
    expect(sessions.p2.send).toHaveBeenCalledWith(Buffer.from([2]));

    // p1's last audio chunk was sent at raw timestamp 1500 (meetingStartedAtMs: 1000
    // below), so a 500ms utterance ending "now" spans raw [1000, 1500] -> normalized [0, 500].
    sessions.p1.handlers.transcript({
      text: "hello",
      isFinal: true,
      durationMs: 500,
      confidence: 0.9,
    });

    expect(onTranscriptEvent).toHaveBeenCalledWith({
      version: 1,
      utteranceId: expect.any(String),
      participantId: "p1",
      speakerName: "p1",
      text: "hello",
      isFinal: true,
      startTs: 0,
      endTs: 500,
      confidence: 0.9,
      source: "deepgram",
    });
  });

  it("closes a participant's session immediately when they leave", () => {
    const s1 = makeFakeSession();
    const createSession = vi.fn(() => s1.connection);
    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent: vi.fn(),
      now: () => 0,
    });

    manager.handleAudioChunk("p1", Buffer.from([1]), 100);
    manager.handleParticipantLeft("p1");

    expect(s1.finish).toHaveBeenCalled();
  });

  it("closes a session after the inactivity timeout elapses", () => {
    const s1 = makeFakeSession();
    const createSession = vi.fn(() => s1.connection);
    let currentTime = 0;
    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 5000,
      meetingStartedAtMs: 0,
      onTranscriptEvent: vi.fn(),
      now: () => currentTime,
    });

    manager.handleAudioChunk("p1", Buffer.from([1]), 100);
    currentTime = 6000;
    manager.checkInactivity(currentTime);

    expect(s1.finish).toHaveBeenCalled();
  });
});

describe("TranscriptionManager (diarized mode)", () => {
  it("resolves participant identity from the active speaker timeline", () => {
    const s1 = makeFakeSession();
    const createSession = vi.fn(() => s1.connection);
    const onTranscriptEvent = vi.fn();
    const manager = new TranscriptionManager({
      mode: "diarized",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent,
      now: () => 0,
    });

    manager.handleActiveSpeaker("p1", 0);
    manager.handleAudioChunk("mixed", Buffer.from([1]), 100);

    s1.handlers.transcript({
      text: "hi",
      isFinal: true,
      durationMs: 100,
      confidence: 0.8,
      speakerLabel: "0",
    });

    expect(onTranscriptEvent).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: "p1", speakerName: "p1" })
    );
  });

  it("falls back to a synthetic speaker id when no active-speaker window matches", () => {
    const s1 = makeFakeSession();
    const createSession = vi.fn(() => s1.connection);
    const onTranscriptEvent = vi.fn();
    const manager = new TranscriptionManager({
      mode: "diarized",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent,
      now: () => 0,
    });

    manager.handleAudioChunk("mixed", Buffer.from([1]), 100);
    s1.handlers.transcript({
      text: "hi",
      isFinal: true,
      durationMs: 100,
      confidence: 0.8,
      speakerLabel: "3",
    });

    expect(onTranscriptEvent).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: "speaker-3", speakerName: "speaker-3" })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/transcriptionManager.test.ts`
Expected: FAIL with "Cannot find module '../../src/transcription/transcriptionManager'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/transcription/transcriptionManager.ts
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { SttSession } from "./sttSession";
import { ActiveSpeakerTimeline } from "./activeSpeakerTimeline";
import { normalizeTimestamp } from "../lib/timestampNormalizer";
import type { DeepgramLiveConnectionLike } from "./deepgramLiveConnection.types";
import type { STTProvider, TranscriptEvent } from "../types/transcriptEvent";

type PartialTranscriptEvent = Omit<TranscriptEvent, "sequenceNumber" | "meetingId">;

export interface TranscriptionManagerDeps {
  mode: "per-participant" | "diarized";
  createSession: (opts: { diarize: boolean }) => DeepgramLiveConnectionLike;
  inactivityTimeoutMs: number;
  meetingStartedAtMs: number;
  onTranscriptEvent: (event: PartialTranscriptEvent) => void;
  now: () => number;
  source?: STTProvider;
}

interface ActiveSession {
  session: SttSession;
  lastActivityMs: number;
  // Raw Zoom timestamp (same epoch as meetingStartedAtMs) of the most recent
  // audio chunk sent to this session — used to derive meeting-relative
  // startTs/endTs, since Deepgram's own start/duration are relative to when
  // its connection opened, not the meeting timeline.
  lastRawTimestampMs: number;
}

const DIARIZED_KEY = "__diarized__";

export class TranscriptionManager extends EventEmitter {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly activeSpeakerTimeline = new ActiveSpeakerTimeline();
  private readonly source: STTProvider;

  constructor(private readonly deps: TranscriptionManagerDeps) {
    super();
    this.source = deps.source ?? "deepgram";
  }

  handleActiveSpeaker(participantId: string, timestamp: number): void {
    this.activeSpeakerTimeline.recordActiveSpeaker(
      participantId,
      normalizeTimestamp(timestamp, this.deps.meetingStartedAtMs)
    );
  }

  handleAudioChunk(participantId: string, buffer: Buffer, timestamp: number): void {
    const key = this.deps.mode === "diarized" ? DIARIZED_KEY : participantId;
    let active = this.sessions.get(key);
    if (!active) {
      active = this.openSession(key);
    }
    active.lastActivityMs = this.deps.now();
    active.lastRawTimestampMs = timestamp;
    active.session.send(buffer);
  }

  handleParticipantLeft(participantId: string): void {
    const active = this.sessions.get(participantId);
    if (active) {
      active.session.close();
      this.sessions.delete(participantId);
    }
  }

  checkInactivity(now: number): void {
    for (const [key, active] of this.sessions.entries()) {
      if (now - active.lastActivityMs > this.deps.inactivityTimeoutMs) {
        active.session.close();
        this.sessions.delete(key);
      }
    }
  }

  private openSession(key: string): ActiveSession {
    const connection = this.deps.createSession({ diarize: this.deps.mode === "diarized" });
    const session = SttSession.start(connection, {
      onResult: (payload) => this.handleResult(key, payload),
      onError: () => {
        /* handled by reconnect logic in Task 11 */
      },
      onClose: () => {
        /* handled by reconnect logic in Task 11 */
      },
    });
    const active: ActiveSession = {
      session,
      lastActivityMs: this.deps.now(),
      lastRawTimestampMs: this.deps.meetingStartedAtMs,
    };
    this.sessions.set(key, active);
    return active;
  }

  private handleResult(
    key: string,
    payload: {
      text: string;
      isFinal: boolean;
      durationMs: number;
      confidence: number;
      speakerLabel?: string;
    }
  ): void {
    const active = this.sessions.get(key);
    const endTsRaw = active?.lastRawTimestampMs ?? this.deps.meetingStartedAtMs;
    const startTsRaw = endTsRaw - payload.durationMs;
    const startTs = normalizeTimestamp(startTsRaw, this.deps.meetingStartedAtMs);
    const endTs = normalizeTimestamp(endTsRaw, this.deps.meetingStartedAtMs);

    const participantId =
      this.deps.mode === "diarized"
        ? this.activeSpeakerTimeline.resolveParticipant(startTs, endTs) ??
          `speaker-${payload.speakerLabel ?? "unknown"}`
        : key;

    this.deps.onTranscriptEvent({
      version: 1,
      utteranceId: randomUUID(),
      participantId,
      speakerName: participantId,
      text: payload.text,
      isFinal: payload.isFinal,
      startTs,
      endTs,
      confidence: payload.confidence,
      source: this.source,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/transcriptionManager.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/transcription/transcriptionManager.ts tests/unit/transcriptionManager.test.ts
git commit -m "Add TranscriptionManager session management for per-participant and diarized modes"
```

---

## Task 11: TranscriptionManager — reconnect with bounded audio buffering

**Files:**
- Modify: `src/transcription/transcriptionManager.ts`
- Test: `tests/unit/transcriptionManagerReconnect.test.ts`

**Interfaces:**
- Consumes/extends Task 10's `TranscriptionManager`.
- Adds: reconnect-with-backoff on `onClose`/`onError`, buffering audio chunks (bounded by `maxBufferedChunks`) while reconnecting, flushing the buffer in order once reconnected, and dropping the oldest chunk with a logged warning if the buffer overflows — per spec's failure semantics for `TranscriptionManager`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/transcriptionManagerReconnect.test.ts
import { describe, it, expect, vi } from "vitest";
import { TranscriptionManager } from "../../src/transcription/transcriptionManager";
import type { DeepgramLiveConnectionLike } from "../../src/transcription/deepgramLiveConnection.types";

function makeFakeSession() {
  const handlers: Record<string, Function> = {};
  const send = vi.fn();
  const finish = vi.fn();
  const connection: DeepgramLiveConnectionLike = {
    onTranscript: (cb) => (handlers.transcript = cb),
    onError: (cb) => (handlers.error = cb),
    onClose: (cb) => (handlers.close = cb),
    send,
    finish,
  };
  return { connection, handlers, send, finish };
}

describe("TranscriptionManager reconnect", () => {
  it("buffers audio while reconnecting and flushes it to the new session in order", async () => {
    const first = makeFakeSession();
    const second = makeFakeSession();
    const createSession = vi
      .fn()
      .mockReturnValueOnce(first.connection)
      .mockReturnValueOnce(second.connection);

    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent: vi.fn(),
      now: () => 0,
      maxBufferedChunks: 10,
      reconnect: { retries: 1, baseDelayMs: 1 },
      sleep: async () => {},
    });

    manager.handleAudioChunk("p1", Buffer.from([1]), 100);
    first.handlers.close();
    manager.handleAudioChunk("p1", Buffer.from([2]), 150);

    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));

    expect(second.send).toHaveBeenCalledWith(Buffer.from([2]));
  });

  it("drops the oldest buffered chunk with a warning when the buffer overflows", async () => {
    const first = makeFakeSession();
    const second = makeFakeSession();
    const createSession = vi
      .fn()
      .mockReturnValueOnce(first.connection)
      .mockReturnValueOnce(second.connection);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent: vi.fn(),
      now: () => 0,
      maxBufferedChunks: 1,
      reconnect: { retries: 1, baseDelayMs: 1 },
      sleep: async () => {},
    });

    manager.handleAudioChunk("p1", Buffer.from([1]), 100);
    first.handlers.close();
    manager.handleAudioChunk("p1", Buffer.from([2]), 150);
    manager.handleAudioChunk("p1", Buffer.from([3]), 160);

    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));

    expect(second.send).toHaveBeenCalledWith(Buffer.from([3]));
    expect(second.send).not.toHaveBeenCalledWith(Buffer.from([2]));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("dropping buffered audio chunk")
    );
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/transcriptionManagerReconnect.test.ts`
Expected: FAIL — `maxBufferedChunks`/`reconnect`/`sleep` aren't accepted yet and reconnect never happens, so `createSession` is only called once.

- [ ] **Step 3: Extend the implementation**

```typescript
// src/transcription/transcriptionManager.ts
// (replace the existing file with this extended version)
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { SttSession } from "./sttSession";
import { ActiveSpeakerTimeline } from "./activeSpeakerTimeline";
import { normalizeTimestamp } from "../lib/timestampNormalizer";
import type { DeepgramLiveConnectionLike } from "./deepgramLiveConnection.types";
import type { STTProvider, TranscriptEvent } from "../types/transcriptEvent";

type PartialTranscriptEvent = Omit<TranscriptEvent, "sequenceNumber" | "meetingId">;

export interface TranscriptionManagerDeps {
  mode: "per-participant" | "diarized";
  createSession: (opts: { diarize: boolean }) => DeepgramLiveConnectionLike;
  inactivityTimeoutMs: number;
  meetingStartedAtMs: number;
  onTranscriptEvent: (event: PartialTranscriptEvent) => void;
  now: () => number;
  source?: STTProvider;
  maxBufferedChunks?: number;
  reconnect?: { retries: number; baseDelayMs: number };
  sleep?: (ms: number) => Promise<void>;
}

interface ActiveSession {
  session: SttSession;
  lastActivityMs: number;
  lastRawTimestampMs: number;
  bufferedChunks: Buffer[];
  reconnecting: boolean;
}

const DIARIZED_KEY = "__diarized__";
const DEFAULT_MAX_BUFFERED_CHUNKS = 250; // ~5s at 20ms/frame
const DEFAULT_RECONNECT = { retries: 5, baseDelayMs: 500 };

export class TranscriptionManager extends EventEmitter {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly activeSpeakerTimeline = new ActiveSpeakerTimeline();
  private readonly source: STTProvider;
  private readonly maxBufferedChunks: number;
  private readonly reconnectConfig: { retries: number; baseDelayMs: number };
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: TranscriptionManagerDeps) {
    super();
    this.source = deps.source ?? "deepgram";
    this.maxBufferedChunks = deps.maxBufferedChunks ?? DEFAULT_MAX_BUFFERED_CHUNKS;
    this.reconnectConfig = deps.reconnect ?? DEFAULT_RECONNECT;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  handleActiveSpeaker(participantId: string, timestamp: number): void {
    this.activeSpeakerTimeline.recordActiveSpeaker(
      participantId,
      normalizeTimestamp(timestamp, this.deps.meetingStartedAtMs)
    );
  }

  handleAudioChunk(participantId: string, buffer: Buffer, timestamp: number): void {
    const key = this.deps.mode === "diarized" ? DIARIZED_KEY : participantId;
    let active = this.sessions.get(key);
    if (!active) {
      active = this.openSession(key);
    }
    active.lastActivityMs = this.deps.now();
    active.lastRawTimestampMs = timestamp;

    if (active.reconnecting) {
      this.bufferChunk(active, buffer);
      return;
    }
    active.session.send(buffer);
  }

  handleParticipantLeft(participantId: string): void {
    const active = this.sessions.get(participantId);
    if (active) {
      active.session.close();
      this.sessions.delete(participantId);
    }
  }

  checkInactivity(now: number): void {
    for (const [key, active] of this.sessions.entries()) {
      if (now - active.lastActivityMs > this.deps.inactivityTimeoutMs) {
        active.session.close();
        this.sessions.delete(key);
      }
    }
  }

  private bufferChunk(active: ActiveSession, buffer: Buffer): void {
    active.bufferedChunks.push(buffer);
    if (active.bufferedChunks.length > this.maxBufferedChunks) {
      active.bufferedChunks.shift();
      console.warn("dropping buffered audio chunk: reconnect buffer full");
    }
  }

  private openSession(key: string): ActiveSession {
    const connection = this.deps.createSession({ diarize: this.deps.mode === "diarized" });
    const session = SttSession.start(connection, {
      onResult: (payload) => this.handleResult(key, payload),
      onError: () => this.beginReconnect(key, 0),
      onClose: () => this.beginReconnect(key, 0),
    });
    const active: ActiveSession = {
      session,
      lastActivityMs: this.deps.now(),
      lastRawTimestampMs: this.deps.meetingStartedAtMs,
      bufferedChunks: [],
      reconnecting: false,
    };
    this.sessions.set(key, active);
    return active;
  }

  private async beginReconnect(key: string, attempt: number): Promise<void> {
    const active = this.sessions.get(key);
    if (!active) return;
    active.reconnecting = true;

    if (attempt >= this.reconnectConfig.retries) {
      this.sessions.delete(key);
      return;
    }

    await this.sleep(this.reconnectConfig.baseDelayMs * 2 ** attempt);

    try {
      const connection = this.deps.createSession({ diarize: this.deps.mode === "diarized" });
      const newSession = SttSession.start(connection, {
        onResult: (payload) => this.handleResult(key, payload),
        onError: () => this.beginReconnect(key, 0),
        onClose: () => this.beginReconnect(key, 0),
      });

      const bufferedChunks = active.bufferedChunks;
      active.session = newSession;
      active.bufferedChunks = [];
      active.reconnecting = false;
      for (const chunk of bufferedChunks) {
        newSession.send(chunk);
      }
    } catch {
      await this.beginReconnect(key, attempt + 1);
    }
  }

  private handleResult(
    key: string,
    payload: {
      text: string;
      isFinal: boolean;
      durationMs: number;
      confidence: number;
      speakerLabel?: string;
    }
  ): void {
    const active = this.sessions.get(key);
    const endTsRaw = active?.lastRawTimestampMs ?? this.deps.meetingStartedAtMs;
    const startTsRaw = endTsRaw - payload.durationMs;
    const startTs = normalizeTimestamp(startTsRaw, this.deps.meetingStartedAtMs);
    const endTs = normalizeTimestamp(endTsRaw, this.deps.meetingStartedAtMs);

    const participantId =
      this.deps.mode === "diarized"
        ? this.activeSpeakerTimeline.resolveParticipant(startTs, endTs) ??
          `speaker-${payload.speakerLabel ?? "unknown"}`
        : key;

    this.deps.onTranscriptEvent({
      version: 1,
      utteranceId: randomUUID(),
      participantId,
      speakerName: participantId,
      text: payload.text,
      isFinal: payload.isFinal,
      startTs,
      endTs,
      confidence: payload.confidence,
      source: this.source,
    });
  }
}
```

- [ ] **Step 4: Run all TranscriptionManager tests to verify they pass**

Run: `npx vitest run tests/unit/transcriptionManager.test.ts tests/unit/transcriptionManagerReconnect.test.ts`
Expected: PASS (7 tests total)

- [ ] **Step 5: Commit**

```bash
git add src/transcription/transcriptionManager.ts tests/unit/transcriptionManagerReconnect.test.ts
git commit -m "Add reconnect-with-bounded-buffering to TranscriptionManager"
```

---

## Task 12: ZoomBotAdapter — types, webhook/client composition, participant tracking

**Files:**
- Create: `src/zoom/zoomBotAdapter.types.ts`
- Create: `src/zoom/zoomBotAdapter.ts`
- Test: `tests/unit/zoomBotAdapter.test.ts`

**Interfaces:**
- Produces: `Participant`, `RtmsClientLike`, `ZoomWebhookSource` interfaces, and `ZoomBotAdapter` (an `EventEmitter` emitting `"meetingStarted"`, `"participantJoined"`, `"participantLeft"`, `"audioChunk"`, `"meetingEnded"`) — consumed by Task 14's server wiring.

Both `RtmsClientLike` and `ZoomWebhookSource` are narrow interfaces; this task's tests use fakes. The real `@zoom/rtms`-backed implementations of these interfaces, and the real participant-roster webhook wiring, are written in Task 14 using the findings from Task 1's spike.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/zoomBotAdapter.test.ts
import { describe, it, expect, vi } from "vitest";
import { ZoomBotAdapter } from "../../src/zoom/zoomBotAdapter";
import type {
  RtmsClientLike,
  ZoomWebhookSource,
} from "../../src/zoom/zoomBotAdapter.types";

function makeFakeWebhookSource() {
  const handlers: Record<string, Function> = {};
  const source: ZoomWebhookSource = {
    onRtmsStarted: (cb) => (handlers.started = cb),
    onRtmsStopped: (cb) => (handlers.stopped = cb),
    onParticipantJoined: (cb) => (handlers.joined = cb),
    onParticipantLeft: (cb) => (handlers.left = cb),
  };
  return { source, handlers };
}

function makeFakeClient() {
  const handlers: Record<string, Function> = {};
  const client: RtmsClientLike = {
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    setAudioParams: vi.fn(),
    onAudioData: (cb) => (handlers.audio = cb),
    onActiveSpeakerEvent: (cb) => (handlers.activeSpeaker = cb),
    onJoinConfirm: (cb) => (handlers.joinConfirm = cb),
    onLeave: (cb) => (handlers.leave = cb),
  };
  return { client, handlers };
}

describe("ZoomBotAdapter", () => {
  it("joins the RTMS client and emits meetingStarted when the webhook fires", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { client } = makeFakeClient();
    const adapter = new ZoomBotAdapter({
      webhookSource: source,
      createClient: () => client,
      audioParams: { mode: 1 },
      reconnect: { retries: 2, baseDelayMs: 1 },
    });

    const onStarted = vi.fn();
    adapter.on("meetingStarted", onStarted);

    await handlers.started({
      meetingId: "m1",
      joinPayload: { token: "abc" },
      participants: [{ participantId: "p1", displayName: "Alex" }],
    });

    expect(client.join).toHaveBeenCalledWith({ token: "abc" });
    expect(client.setAudioParams).toHaveBeenCalledWith({ mode: 1 });
    expect(onStarted).toHaveBeenCalledWith("m1", [
      { participantId: "p1", displayName: "Alex" },
    ]);
  });

  it("emits audioChunk with the participant id from RTMS metadata", async () => {
    const { source, handlers: webhookHandlers } = makeFakeWebhookSource();
    const { client, handlers: clientHandlers } = makeFakeClient();
    const adapter = new ZoomBotAdapter({
      webhookSource: source,
      createClient: () => client,
      audioParams: {},
      reconnect: { retries: 2, baseDelayMs: 1 },
    });

    const onAudioChunk = vi.fn();
    adapter.on("audioChunk", onAudioChunk);

    await webhookHandlers.started({
      meetingId: "m1",
      joinPayload: {},
      participants: [],
    });

    const buf = Buffer.from([1, 2, 3]);
    clientHandlers.audio(buf, 3, 5000, { userId: "p1", userName: "Alex" });

    expect(onAudioChunk).toHaveBeenCalledWith("p1", buf, 5000);
  });

  it("emits participantJoined/participantLeft from the webhook source", () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { client } = makeFakeClient();
    const adapter = new ZoomBotAdapter({
      webhookSource: source,
      createClient: () => client,
      audioParams: {},
      reconnect: { retries: 2, baseDelayMs: 1 },
    });

    const onJoined = vi.fn();
    const onLeft = vi.fn();
    adapter.on("participantJoined", onJoined);
    adapter.on("participantLeft", onLeft);

    handlers.joined({ meetingId: "m1", participant: { participantId: "p2", displayName: "Sam" } });
    handlers.left({ meetingId: "m1", participantId: "p2" });

    expect(onJoined).toHaveBeenCalledWith({ participantId: "p2", displayName: "Sam" });
    expect(onLeft).toHaveBeenCalledWith("p2");
  });

  it("emits a clean meetingEnded when the RTMS stream stops normally", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { client } = makeFakeClient();
    const adapter = new ZoomBotAdapter({
      webhookSource: source,
      createClient: () => client,
      audioParams: {},
      reconnect: { retries: 2, baseDelayMs: 1 },
    });

    await handlers.started({ meetingId: "m1", joinPayload: {}, participants: [] });

    const onEnded = vi.fn();
    adapter.on("meetingEnded", onEnded);
    handlers.stopped({ meetingId: "m1" });

    expect(onEnded).toHaveBeenCalledWith("ended");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/zoomBotAdapter.test.ts`
Expected: FAIL with "Cannot find module '../../src/zoom/zoomBotAdapter'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/zoom/zoomBotAdapter.types.ts
export interface Participant {
  participantId: string;
  displayName: string;
}

export interface RtmsClientLike {
  join(payload: unknown): Promise<void> | void;
  leave(): Promise<void> | void;
  setAudioParams(params: Record<string, number>): void;
  onAudioData(
    cb: (
      buffer: Buffer,
      size: number,
      timestamp: number,
      metadata: { userId: string; userName: string }
    ) => void
  ): void;
  onActiveSpeakerEvent(
    cb: (timestamp: number, userId: string, userName: string) => void
  ): void;
  onJoinConfirm(cb: (reason: number) => void): void;
  onLeave(cb: (reason: number) => void): void;
}

export interface ZoomWebhookSource {
  onRtmsStarted(
    cb: (payload: {
      meetingId: string;
      joinPayload: unknown;
      participants: Participant[];
    }) => void | Promise<void>
  ): void;
  onRtmsStopped(cb: (payload: { meetingId: string }) => void): void;
  onParticipantJoined(
    cb: (payload: { meetingId: string; participant: Participant }) => void
  ): void;
  onParticipantLeft(
    cb: (payload: { meetingId: string; participantId: string }) => void
  ): void;
}
```

```typescript
// src/zoom/zoomBotAdapter.ts
import { EventEmitter } from "node:events";
import type {
  Participant,
  RtmsClientLike,
  ZoomWebhookSource,
} from "./zoomBotAdapter.types";

export interface ZoomBotAdapterDeps {
  webhookSource: ZoomWebhookSource;
  createClient: () => RtmsClientLike;
  audioParams: Record<string, number>;
  reconnect: { retries: number; baseDelayMs: number };
  sleep?: (ms: number) => Promise<void>;
}

const NORMAL_LEAVE_REASON = 0;

export class ZoomBotAdapter extends EventEmitter {
  private meetingId?: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: ZoomBotAdapterDeps) {
    super();
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.deps.webhookSource.onRtmsStarted((payload) => this.handleRtmsStarted(payload));
    this.deps.webhookSource.onRtmsStopped((payload) => this.handleRtmsStopped(payload));
    this.deps.webhookSource.onParticipantJoined(({ participant }) =>
      this.emit("participantJoined", participant)
    );
    this.deps.webhookSource.onParticipantLeft(({ participantId }) =>
      this.emit("participantLeft", participantId)
    );
  }

  private async handleRtmsStarted(payload: {
    meetingId: string;
    joinPayload: unknown;
    participants: Participant[];
  }): Promise<void> {
    this.meetingId = payload.meetingId;
    await this.connectClient(payload.joinPayload, 0);
    this.emit("meetingStarted", payload.meetingId, payload.participants);
  }

  private handleRtmsStopped(payload: { meetingId: string }): void {
    if (payload.meetingId !== this.meetingId) return;
    this.emit("meetingEnded", "ended");
  }

  private async connectClient(joinPayload: unknown, attempt: number): Promise<void> {
    const client = this.deps.createClient();
    client.setAudioParams(this.deps.audioParams);
    client.onAudioData((buffer, _size, timestamp, metadata) => {
      this.emit("audioChunk", metadata.userId, buffer, timestamp);
    });
    client.onActiveSpeakerEvent((timestamp, userId) => {
      this.emit("activeSpeaker", userId, timestamp);
    });
    client.onLeave((reason) => {
      if (reason === NORMAL_LEAVE_REASON) return;
      this.retryConnect(joinPayload, attempt, new Error(`unexpected leave, reason=${reason}`));
    });

    try {
      await client.join(joinPayload);
    } catch (err) {
      await this.retryConnect(joinPayload, attempt, err);
    }
  }

  private async retryConnect(joinPayload: unknown, attempt: number, _err: unknown): Promise<void> {
    if (attempt >= this.deps.reconnect.retries) {
      this.emit("meetingEnded", "ended_error");
      return;
    }
    await this.sleep(this.deps.reconnect.baseDelayMs * 2 ** attempt);
    await this.connectClient(joinPayload, attempt + 1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/zoomBotAdapter.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/zoom/zoomBotAdapter.types.ts src/zoom/zoomBotAdapter.ts tests/unit/zoomBotAdapter.test.ts
git commit -m "Add ZoomBotAdapter with webhook/client composition and participant tracking"
```

---

## Task 13: ZoomBotAdapter — reconnect-with-backoff test coverage

**Files:**
- Modify: `tests/unit/zoomBotAdapter.test.ts`

**Interfaces:**
- Exercises the reconnect/`ended_error` path already implemented in Task 12's `connectClient`/`retryConnect`, ensuring it's covered by a test (Task 12 wrote the logic; this task locks in its behavior with an explicit regression test, matching the spec's failure semantics: "If reconnection ultimately fails, publish `meeting_lifecycle: ended_error`").

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/zoomBotAdapter.test.ts`:

```typescript
it("emits meetingEnded with ended_error after exhausting reconnect attempts", async () => {
  const { source, handlers } = makeFakeWebhookSource();
  let joinCallCount = 0;
  const client: RtmsClientLike = {
    join: vi.fn(async () => {
      joinCallCount += 1;
      throw new Error("connect failed");
    }),
    leave: vi.fn(),
    setAudioParams: vi.fn(),
    onAudioData: vi.fn(),
    onActiveSpeakerEvent: vi.fn(),
    onJoinConfirm: vi.fn(),
    onLeave: vi.fn(),
  };
  const adapter = new ZoomBotAdapter({
    webhookSource: source,
    createClient: () => client,
    audioParams: {},
    reconnect: { retries: 2, baseDelayMs: 1 },
  });

  const onEnded = vi.fn();
  adapter.on("meetingEnded", onEnded);

  await handlers.started({ meetingId: "m1", joinPayload: {}, participants: [] });

  expect(joinCallCount).toBe(3); // initial attempt + 2 retries
  expect(onEnded).toHaveBeenCalledWith("ended_error");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/zoomBotAdapter.test.ts`
Expected: FAIL if `retryConnect`'s recursive `await` chain isn't fully awaited by `handleRtmsStarted` — inspect the failure output; if `handleRtmsStarted` doesn't `await connectClient` to completion across retries, the test will see `onEnded` not yet called.

- [ ] **Step 3: Fix if needed**

`connectClient` in Task 12 already `await`s `retryConnect`, which `await`s `connectClient` recursively, and `handleRtmsStarted` `await`s the outer `connectClient` call — so the recursive chain resolves before `handleRtmsStarted` emits `meetingStarted`. No production code change should be needed; if the test fails, verify `handleRtmsStarted`'s `await this.connectClient(...)` and `retryConnect`'s `await this.connectClient(...)` are both present (see Task 12's implementation).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/zoomBotAdapter.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/unit/zoomBotAdapter.test.ts
git commit -m "Add regression test for ZoomBotAdapter reconnect exhaustion"
```

---

## Task 14: Server wiring — composition root + end-to-end integration test

**Files:**
- Create: `src/zoom/realRtmsClient.ts`
- Create: `src/zoom/realWebhookSource.ts`
- Create: `src/server/index.ts`
- Test: `tests/integration/pipeline.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-13.
- Produces: `startServer(): Promise<void>` (the real production entry point, run via `npm run dev`), and proves the whole in-process wiring (`ZoomBotAdapter` events → `TranscriptionManager` → `TranscriptPipeline`) works end-to-end using a synthetic adapter.

The real Zoom-specific files (`realRtmsClient.ts`, `realWebhookSource.ts`) are where `@zoom/rtms`'s actual enums/webhook helpers are used — cross-check the exact symbol names (`rtms.AudioCodec.L16`, `rtms.AudioSampleRate.SR_16K`, `rtms.AudioChannel.MONO`, `rtms.AudioDataOption.AUDIO_MULTI_STREAMS`) against the installed package's type definitions and Task 1's findings doc before relying on them; they are not covered by automated tests here (that's Task 16's manual/live test) since they require a live Zoom connection.

- [ ] **Step 1: Write the failing integration test**

```typescript
// tests/integration/pipeline.integration.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { EventEmitter } from "node:events";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { closeRedisClient, getRedisClient } from "../../src/redis/client";
import { ZoomBotAdapter } from "../../src/zoom/zoomBotAdapter";
import { TranscriptionManager } from "../../src/transcription/transcriptionManager";
import { TranscriptPipeline } from "../../src/pipeline/transcriptPipeline";
import { PostgresTranscriptStore } from "../../src/pipeline/postgresTranscriptStore";
import { RedisTranscriptPublisher } from "../../src/pipeline/redisTranscriptPublisher";
import { SequenceNumberAllocator } from "../../src/pipeline/sequenceNumberAllocator";
import type {
  RtmsClientLike,
  ZoomWebhookSource,
} from "../../src/zoom/zoomBotAdapter.types";
import type { DeepgramLiveConnectionLike } from "../../src/transcription/deepgramLiveConnection.types";

describe("end-to-end pipeline wiring", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
    await closeRedisClient();
  });

  it("carries a synthetic meeting from Zoom events to the Redis Stream and Postgres", async () => {
    const meetingId = "integration-test-1";
    const webhookEmitter = new EventEmitter();
    const webhookSource: ZoomWebhookSource = {
      onRtmsStarted: (cb) => webhookEmitter.on("started", cb),
      onRtmsStopped: (cb) => webhookEmitter.on("stopped", cb),
      onParticipantJoined: (cb) => webhookEmitter.on("joined", cb),
      onParticipantLeft: (cb) => webhookEmitter.on("left", cb),
    };

    let deepgramEmitter: EventEmitter | undefined;
    const fakeRtmsClient: RtmsClientLike = {
      join: vi.fn().mockResolvedValue(undefined),
      leave: vi.fn(),
      setAudioParams: vi.fn(),
      onAudioData: (cb) => webhookEmitter.on("audio", ({ buf, ts, meta }) => cb(buf, buf.length, ts, meta)),
      onActiveSpeakerEvent: vi.fn(),
      onJoinConfirm: vi.fn(),
      onLeave: vi.fn(),
    };

    const zoomBotAdapter = new ZoomBotAdapter({
      webhookSource,
      createClient: () => fakeRtmsClient,
      audioParams: {},
      reconnect: { retries: 1, baseDelayMs: 1 },
    });

    const pipeline = new TranscriptPipeline({
      store: new PostgresTranscriptStore(),
      publisher: new RedisTranscriptPublisher(),
      allocator: new SequenceNumberAllocator(),
      onAlert: (msg, err) => console.error(msg, err),
      postgresRetry: { retries: 1, baseDelayMs: 1 },
      redisRetry: { retries: 1, baseDelayMs: 1 },
    });

    const transcriptionManager = new TranscriptionManager({
      mode: "per-participant",
      createSession: (): DeepgramLiveConnectionLike => {
        deepgramEmitter = new EventEmitter();
        return {
          onTranscript: (cb) => deepgramEmitter!.on("transcript", cb),
          onError: (cb) => deepgramEmitter!.on("error", cb),
          onClose: (cb) => deepgramEmitter!.on("close", cb),
          send: vi.fn(),
          finish: vi.fn(),
        };
      },
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent: (event) =>
        pipeline.handleTranscriptEvent({ ...event, meetingId }),
      now: () => Date.now(),
    });

    zoomBotAdapter.on("meetingStarted", (mId, participants) =>
      pipeline.handleMeetingStarted(mId, 0, participants)
    );
    zoomBotAdapter.on("audioChunk", (participantId, buffer, timestamp) =>
      transcriptionManager.handleAudioChunk(participantId, buffer, timestamp)
    );
    zoomBotAdapter.on("meetingEnded", (status) =>
      pipeline.handleMeetingEnded(meetingId, Date.now(), status)
    );

    webhookEmitter.emit("started", {
      meetingId,
      joinPayload: {},
      participants: [{ participantId: "p1", displayName: "Alex" }],
    });
    await new Promise((r) => setTimeout(r, 10));

    webhookEmitter.emit("audio", {
      buf: Buffer.from([1, 2, 3]),
      ts: 100,
      meta: { userId: "p1", userName: "Alex" },
    });
    await new Promise((r) => setTimeout(r, 10));

    // Audio was sent at raw timestamp 100 (meetingStartedAtMs: 0), so a 50ms
    // utterance ending "now" fits within elapsed time (raw [50, 100] -> normalized [50, 100]).
    deepgramEmitter!.emit("transcript", {
      text: "hello from integration test",
      isFinal: true,
      durationMs: 50,
      confidence: 0.9,
    });
    await new Promise((r) => setTimeout(r, 10));

    webhookEmitter.emit("stopped", { meetingId });
    await new Promise((r) => setTimeout(r, 10));

    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT text FROM transcript_events WHERE meeting_id = $1",
      [meetingId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("hello from integration test");

    const redis = await getRedisClient();
    const entries = await redis.xRange(`meeting:${meetingId}:transcript`, "-", "+");
    const kinds = entries.map((e) => e.message.kind);
    expect(kinds).toEqual(["meeting_lifecycle", "transcript", "meeting_lifecycle"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/pipeline.integration.test.ts`
Expected: FAIL — passes once `src/server/index.ts` and the real Zoom files exist as importable modules is not required for this test (it wires Tasks 2-13 directly), but it will fail until this exact wiring is exercised for the first time; check the failure message matches an assertion mismatch, not a missing-module error, before moving on (all imported modules already exist from prior tasks).

- [ ] **Step 3: Write the real Zoom wiring and server entry point**

```typescript
// src/zoom/realRtmsClient.ts
import * as rtms from "@zoom/rtms";
import type { RtmsClientLike } from "./zoomBotAdapter.types";

// Cross-check these enum names against the installed @zoom/rtms type
// definitions and docs/superpowers/notes/zoom-rtms-capability-findings.md
// (Task 1) before relying on them in production.
export const PRODUCTION_AUDIO_PARAMS = {
  codec: rtms.AudioCodec.L16,
  sampleRate: rtms.AudioSampleRate.SR_16K,
  channel: rtms.AudioChannel.MONO,
  dataOpt: rtms.AudioDataOption.AUDIO_MULTI_STREAMS,
};

export function createRealRtmsClient(): RtmsClientLike {
  return new rtms.Client() as unknown as RtmsClientLike;
}
```

```typescript
// src/zoom/realWebhookSource.ts
import * as rtms from "@zoom/rtms";
import type { ZoomWebhookSource } from "./zoomBotAdapter.types";

// meeting.participant_joined / meeting.participant_left are standard Zoom
// Meetings webhooks, subscribed separately from the RTMS-specific
// meeting.rtms_started / meeting.rtms_stopped events handled below.
export function createRealWebhookSource(): ZoomWebhookSource {
  const startedHandlers: Array<(p: any) => void> = [];
  const stoppedHandlers: Array<(p: any) => void> = [];
  const joinedHandlers: Array<(p: any) => void> = [];
  const leftHandlers: Array<(p: any) => void> = [];

  rtms.onWebhookEvent(({ event, payload }: { event: string; payload: any }) => {
    if (event === "meeting.rtms_started") {
      const mapped = {
        meetingId: payload.meeting_uuid,
        joinPayload: payload,
        participants: (payload.participants ?? []).map((p: any) => ({
          participantId: p.user_id,
          displayName: p.user_name,
        })),
      };
      startedHandlers.forEach((h) => h(mapped));
    } else if (event === "meeting.rtms_stopped") {
      stoppedHandlers.forEach((h) => h({ meetingId: payload.meeting_uuid }));
    } else if (event === "meeting.participant_joined") {
      joinedHandlers.forEach((h) =>
        h({
          meetingId: payload.object.uuid,
          participant: {
            participantId: payload.object.participant.user_id,
            displayName: payload.object.participant.user_name,
          },
        })
      );
    } else if (event === "meeting.participant_left") {
      leftHandlers.forEach((h) =>
        h({
          meetingId: payload.object.uuid,
          participantId: payload.object.participant.user_id,
        })
      );
    }
  });

  return {
    onRtmsStarted: (cb) => startedHandlers.push(cb),
    onRtmsStopped: (cb) => stoppedHandlers.push(cb),
    onParticipantJoined: (cb) => joinedHandlers.push(cb),
    onParticipantLeft: (cb) => leftHandlers.push(cb),
  };
}
```

```typescript
// src/server/index.ts
import "dotenv/config";
import { ZoomBotAdapter } from "../zoom/zoomBotAdapter";
import { createRealRtmsClient, PRODUCTION_AUDIO_PARAMS } from "../zoom/realRtmsClient";
import { createRealWebhookSource } from "../zoom/realWebhookSource";
import { TranscriptionManager } from "../transcription/transcriptionManager";
import { createDeepgramSession } from "../transcription/deepgramClient";
import { TranscriptPipeline } from "../pipeline/transcriptPipeline";
import { PostgresTranscriptStore } from "../pipeline/postgresTranscriptStore";
import { RedisTranscriptPublisher } from "../pipeline/redisTranscriptPublisher";
import { SequenceNumberAllocator } from "../pipeline/sequenceNumberAllocator";

export async function startServer(): Promise<void> {
  const zoomBotAdapter = new ZoomBotAdapter({
    webhookSource: createRealWebhookSource(),
    createClient: createRealRtmsClient,
    audioParams: PRODUCTION_AUDIO_PARAMS,
    reconnect: { retries: 5, baseDelayMs: 500 },
  });

  const pipeline = new TranscriptPipeline({
    store: new PostgresTranscriptStore(),
    publisher: new RedisTranscriptPublisher(),
    allocator: new SequenceNumberAllocator(),
    onAlert: (message, err) => console.error(message, err),
  });

  let meetingId = "";
  let meetingStartedAtMs = 0;
  const transcriptionManager = new TranscriptionManager({
    mode: "per-participant",
    createSession: (opts) => createDeepgramSession(process.env.DEEPGRAM_API_KEY!, opts),
    inactivityTimeoutMs: 5 * 60_000,
    meetingStartedAtMs: 0,
    onTranscriptEvent: (event) => pipeline.handleTranscriptEvent({ ...event, meetingId }),
    now: () => Date.now(),
  });

  zoomBotAdapter.on("meetingStarted", (mId, participants) => {
    meetingId = mId;
    meetingStartedAtMs = Date.now();
    void pipeline.handleMeetingStarted(mId, meetingStartedAtMs, participants);
  });
  zoomBotAdapter.on("audioChunk", (participantId, buffer, timestamp) => {
    transcriptionManager.handleAudioChunk(participantId, buffer, timestamp);
  });
  zoomBotAdapter.on("activeSpeaker", (participantId, timestamp) => {
    transcriptionManager.handleActiveSpeaker(participantId, timestamp);
  });
  zoomBotAdapter.on("participantLeft", (participantId) => {
    transcriptionManager.handleParticipantLeft(participantId);
  });
  zoomBotAdapter.on("meetingEnded", (status) => {
    void pipeline.handleMeetingEnded(meetingId, Date.now(), status);
  });

  setInterval(() => transcriptionManager.checkInactivity(Date.now()), 30_000);

  console.log("Falcon Transcription Service listening for RTMS webhooks");
}

startServer().catch((err) => {
  console.error("failed to start server", err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `DATABASE_URL=postgres://localhost:5432/falcon_transcription REDIS_URL=redis://localhost:6379 npx vitest run tests/integration/pipeline.integration.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/zoom/realRtmsClient.ts src/zoom/realWebhookSource.ts src/server/index.ts tests/integration/pipeline.integration.test.ts
git commit -m "Wire ZoomBotAdapter, TranscriptionManager, and TranscriptPipeline end-to-end"
```

---

## Task 15: Contract test — standalone Redis Stream consumer

**Files:**
- Create: `tests/contract/redisStreamContract.test.ts`

**Interfaces:**
- Consumes: only the `redis` package directly — deliberately does **not** import anything from `src/pipeline`, `src/zoom`, or `src/transcription`, to prove the Redis Stream itself (not the internal module APIs) is the subsystem's public contract, per spec.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/contract/redisStreamContract.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "redis";

describe("Redis Stream public contract", () => {
  it("is consumable using only the redis package, with no internal pipeline imports", async () => {
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    const meetingId = "contract-test-1";
    const streamKey = `meeting:${meetingId}:transcript`;
    await client.del(streamKey);

    await client.xAdd(streamKey, "*", {
      kind: "meeting_lifecycle",
      payload: JSON.stringify({
        type: "meeting_lifecycle",
        meetingId,
        status: "started",
        timestamp: 0,
        participants: [],
      }),
    });
    await client.xAdd(streamKey, "*", {
      kind: "transcript",
      payload: JSON.stringify({
        version: 1,
        utteranceId: "u1",
        meetingId,
        participantId: "p1",
        speakerName: "Alex",
        text: "hello",
        isFinal: true,
        startTs: 0,
        endTs: 500,
        confidence: 0.9,
        source: "deepgram",
        sequenceNumber: 1,
      }),
    });

    const entries = await client.xRange(streamKey, "-", "+");
    expect(entries).toHaveLength(2);
    expect(entries[0].message.kind).toBe("meeting_lifecycle");
    expect(entries[1].message.kind).toBe("transcript");
    const transcriptPayload = JSON.parse(entries[1].message.payload);
    expect(transcriptPayload.text).toBe("hello");
    expect(transcriptPayload.sequenceNumber).toBe(1);

    await client.quit();
  });
});
```

This test doesn't call `RedisTranscriptPublisher` — it writes and reads the stream directly, verifying that a completely independent consumer (like a future Knowledge Graph Builder) needs nothing beyond the `redis` package and the documented wire format to work with this subsystem's output.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/contract/redisStreamContract.test.ts`
Expected: FAIL only if Redis isn't reachable at `REDIS_URL` — otherwise this test should pass immediately since it only exercises the `redis` package directly; run it once with `REDIS_URL` unset to confirm it fails with a connection error, confirming the test isn't accidentally vacuous.

- [ ] **Step 3: Run with `REDIS_URL` set to verify it passes**

Run: `REDIS_URL=redis://localhost:6379 npx vitest run tests/contract/redisStreamContract.test.ts`
Expected: PASS (1 test)

- [ ] **Step 4: Commit**

```bash
git add tests/contract/redisStreamContract.test.ts
git commit -m "Add standalone Redis Stream contract test"
```

---

## Task 16: Manual/live Zoom test meeting verification

**Files:** none (manual QA pass, no code changes)

**Interfaces:** exercises the full system built in Tasks 1-15 against a real Zoom meeting.

- [ ] **Step 1: Start the service**

Run: `npm run migrate && npm run dev` (with a valid `.env` populated per Global Constraints, and the webhook URL registered in the Zoom Marketplace app pointing at this service).

- [ ] **Step 2: Start a real Zoom meeting with RTMS enabled and at least two speaking participants**

Speak as each participant in turn, including some overlapping speech.

- [ ] **Step 3: Verify transcript accuracy and speaker attribution**

Check: `SELECT participant_id, speaker_name, text, sequence_number FROM transcript_events WHERE meeting_id = '<meeting_uuid>' ORDER BY sequence_number;` — confirm each row's `participant_id` matches who actually spoke, and `text` is a reasonably accurate transcription.

- [ ] **Step 4: Verify end-to-end latency**

Compare wall-clock time of speaking a phrase against the `created_at` timestamp of its corresponding row — confirm delay is on the order of a few seconds, consistent with the spec's "low latency" goal.

- [ ] **Step 5: Verify the Redis Stream carries the full session**

Run: `redis-cli XRANGE meeting:<meeting_uuid>:transcript - +` — confirm it starts with a `meeting_lifecycle: started` entry, contains interleaved `transcript` entries for both speakers, and ends with a `meeting_lifecycle: ended` entry after the meeting is stopped.

- [ ] **Step 6: Record any deviations from the capability findings doc**

If real behavior differs from what Task 1 documented (e.g. different metadata field names, different reason codes), update `docs/superpowers/notes/zoom-rtms-capability-findings.md` and adjust `src/zoom/realWebhookSource.ts`/`realRtmsClient.ts` accordingly, re-running Tasks 12-14's automated tests to confirm nothing regressed.

- [ ] **Step 7: Commit any fixes made in Step 6**

```bash
git add -A
git commit -m "Fix Zoom RTMS wiring based on live meeting verification"
```
