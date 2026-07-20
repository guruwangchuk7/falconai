# Knowledge Graph Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone worker process that, once a meeting ends, automatically extracts decisions/people/topics from its transcript via Claude and writes them into a queryable Postgres graph (nodes + edges).

**Architecture:** A `KnowledgeGraphWorker` polls the existing `meetings` table for ended meetings lacking a completed graph build, then drives each one through `TranscriptFetcher` (Postgres → formatted text) → `DecisionExtractor` (Claude, forced JSON schema) → `GraphWriter` (transactional Postgres upsert). A new `graph_builds` table makes each meeting's build idempotent and crash-recoverable. A new composition root (`src/server/knowledgeGraphIndex.ts`) wires the real pieces together, analogous to the existing `src/server/livekitIndex.ts`.

**Tech Stack:** TypeScript, `pg` (already a dependency), `@anthropic-ai/sdk` (new dependency), vitest, tsx.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-knowledge-graph-builder-design.md`. Read it before starting if anything below is unclear.
- Post-meeting batch only — no live/incremental processing during a meeting.
- No action-item/follow-up entity type in v1 — only Meeting, Person, Decision, Topic nodes.
- Entity resolution across meetings is exact, case-insensitive name matching only (trim + lowercase) — no fuzzy/ML matching.
- No integration with GitHub/Jira/Linear — topics are captured as plain text labels only.
- No query API/dashboard/UI over the graph — it's queried directly via SQL (this sub-project's "public contract," analogous to the Redis Stream for sub-project 1).
- Model is `claude-opus-4-8` via `@anthropic-ai/sdk`, using forced structured output (`output_config.format` with a JSON schema) — never free-text parsing of the model's response.
- This sub-project does **not** consume the Redis Stream. The trigger is polling the `meetings` table (`status IN ('ended', 'ended_error')`) — Redis Streams have no wildcard subscription across the dynamically-created per-meeting stream keys, so a consumer-group approach can't generically discover new meetings.
- A `graph_builds` row with `status = 'failed'` is never automatically retried — left for manual reprocessing.
- The poll loop processes candidate meetings strictly sequentially (`for` + `await`, never `Promise.all`) within one continuously-running process — this is what makes including `processing`-status rows in the candidate query safe for crash recovery without double-processing a build still genuinely in flight.
- `npm install` requires `--force` on Windows (per `CLAUDE.md`, due to `@zoom/rtms`'s `os` restriction) — this applies when installing `@anthropic-ai/sdk` too.
- `tests/` is intentionally excluded from `tsconfig.json`'s `include` — do not add it back.
- Follow the existing repo convention: classes that talk to Postgres directly (no injected client) are tested via integration tests against a real local Postgres, not mocks — see `PostgresTranscriptStore` / `tests/integration/postgresTranscriptStore.integration.test.ts` for the pattern. Classes with an injectable dependency (like `TranscriptPipeline`) are unit-tested against fakes.
- Local Postgres must be reachable at `DATABASE_URL` for every integration test in this plan (see `CLAUDE.md` for how to start it on this machine).

---

### Task 1: Extend the Postgres schema for the knowledge graph

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `tests/integration/db.integration.test.ts`

**Interfaces:**
- Produces: three new tables — `graph_nodes(id uuid pk, type text, natural_key text nullable, label text, attributes jsonb, created_at timestamptz)` with a unique index on `(type, natural_key)` where `natural_key is not null`; `graph_edges(id uuid pk, from_node_id uuid fk→graph_nodes.id on delete cascade, to_node_id uuid fk→graph_nodes.id on delete cascade, type text, created_at timestamptz)` with a unique constraint on `(from_node_id, to_node_id, type)`; `graph_builds(meeting_id text pk fk→meetings.meeting_id, status text, error text nullable, started_at timestamptz nullable, completed_at timestamptz nullable)`. All later tasks depend on these exact column names and constraints.

- [ ] **Step 1: Write the failing test**

Add to the end of `tests/integration/db.integration.test.ts` (inside the existing `describe("database schema", ...)` block, after the existing `it`):

```typescript
  it("enforces unique (type, natural_key) on graph_nodes, ignoring rows with a null natural_key", async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO graph_nodes (type, natural_key, label) VALUES ('person', 'alex', 'Alex')`
    );
    await expect(
      pool.query(`INSERT INTO graph_nodes (type, natural_key, label) VALUES ('person', 'alex', 'Alex Again')`)
    ).rejects.toThrow();
    // Two decision nodes (natural_key IS NULL) must NOT collide with each other.
    await pool.query(`INSERT INTO graph_nodes (type, natural_key, label) VALUES ('decision', NULL, 'Decision A')`);
    await pool.query(`INSERT INTO graph_nodes (type, natural_key, label) VALUES ('decision', NULL, 'Decision B')`);
    const { rows } = await pool.query(`SELECT label FROM graph_nodes WHERE type = 'decision' ORDER BY label`);
    expect(rows).toHaveLength(2);
  });

  it("cascades edge deletes when a node is deleted, and rejects duplicate edges", async () => {
    const pool = getPool();
    const { rows: nodeRows } = await pool.query(
      `INSERT INTO graph_nodes (type, natural_key, label) VALUES ('person', 'cascade-test-person', 'Cascade Test'), ('meeting', 'cascade-test-meeting', 'cascade-test-meeting') RETURNING id, type`
    );
    const personId = nodeRows.find((r: { type: string }) => r.type === "person").id;
    const meetingId = nodeRows.find((r: { type: string }) => r.type === "meeting").id;

    await pool.query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, type) VALUES ($1, $2, 'PARTICIPATED_IN')`,
      [personId, meetingId]
    );
    await expect(
      pool.query(
        `INSERT INTO graph_edges (from_node_id, to_node_id, type) VALUES ($1, $2, 'PARTICIPATED_IN')`,
        [personId, meetingId]
      )
    ).rejects.toThrow();

    await pool.query(`DELETE FROM graph_nodes WHERE id = $1`, [personId]);
    const { rows: edgeRows } = await pool.query(
      `SELECT id FROM graph_edges WHERE from_node_id = $1`,
      [personId]
    );
    expect(edgeRows).toHaveLength(0);
  });

  it("allows inserting and reading a graph_builds row scoped to an existing meeting", async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO meetings (meeting_id, started_at, status) VALUES ($1, now(), 'ended') ON CONFLICT (meeting_id) DO NOTHING`,
      ["graph-builds-schema-test"]
    );
    await pool.query(
      `INSERT INTO graph_builds (meeting_id, status, started_at) VALUES ($1, 'processing', now())
       ON CONFLICT (meeting_id) DO UPDATE SET status = 'processing'`,
      ["graph-builds-schema-test"]
    );
    const { rows } = await pool.query(
      `SELECT status FROM graph_builds WHERE meeting_id = $1`,
      ["graph-builds-schema-test"]
    );
    expect(rows[0].status).toBe("processing");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/db.integration.test.ts`
Expected: FAIL — `relation "graph_nodes" does not exist` (or similar) for all three new tests.

- [ ] **Step 3: Write the schema migration**

Append to `src/db/schema.sql` (after the existing `idx_transcript_events_meeting` index):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS graph_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  natural_key TEXT,
  label TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_nodes_type_natural_key
  ON graph_nodes (type, natural_key) WHERE natural_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_node_id, to_node_id, type)
);

CREATE TABLE IF NOT EXISTS graph_builds (
  meeting_id TEXT PRIMARY KEY REFERENCES meetings(meeting_id),
  status TEXT NOT NULL,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/db.integration.test.ts`
Expected: PASS (all tests in the file, including the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.sql tests/integration/db.integration.test.ts
git commit -m "Add graph_nodes/graph_edges/graph_builds tables for the Knowledge Graph Builder"
```

---

### Task 2: Knowledge graph types and the pure transcript formatter

**Files:**
- Create: `src/knowledgeGraph/knowledgeGraph.types.ts`
- Create: `src/knowledgeGraph/transcriptFormatter.ts`
- Test: `tests/unit/transcriptFormatter.test.ts`

**Interfaces:**
- Produces: `DecisionCandidate { text: string; speakerName: string; confidence: number; topics: string[] }`, `TopicMention { label: string }`, `ExtractionResult { decisions: DecisionCandidate[]; topics: TopicMention[] }`, `ParticipantMention { participantId: string; speakerName: string }`, `FormattedTranscript { promptText: string; participants: ParticipantMention[] }` (all in `knowledgeGraph.types.ts`); `TranscriptEventRow { participantId: string; speakerName: string; text: string; startTs: number }` and `formatTranscriptForExtraction(rows: TranscriptEventRow[]): FormattedTranscript` (in `transcriptFormatter.ts`). Task 3 consumes `formatTranscriptForExtraction` and `TranscriptEventRow`. Tasks 4–8 consume the types in `knowledgeGraph.types.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/transcriptFormatter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatTranscriptForExtraction } from "../../src/knowledgeGraph/transcriptFormatter";

describe("formatTranscriptForExtraction", () => {
  it("returns empty output for no rows", () => {
    const result = formatTranscriptForExtraction([]);
    expect(result).toEqual({ promptText: "", participants: [] });
  });

  it("formats each row as [startTs] speakerName: text, joined by newlines", () => {
    const result = formatTranscriptForExtraction([
      { participantId: "p1", speakerName: "Alex", text: "Let's use Postgres.", startTs: 0 },
      { participantId: "p2", speakerName: "Sam", text: "Agreed.", startTs: 500 },
    ]);
    expect(result.promptText).toBe(
      "[0] Alex: Let's use Postgres.\n[500] Sam: Agreed."
    );
  });

  it("dedupes participants by participantId, keeping the first speakerName seen", () => {
    const result = formatTranscriptForExtraction([
      { participantId: "p1", speakerName: "Alex", text: "hi", startTs: 0 },
      { participantId: "p2", speakerName: "Sam", text: "hi", startTs: 100 },
      { participantId: "p1", speakerName: "Alex", text: "again", startTs: 200 },
    ]);
    expect(result.participants).toEqual([
      { participantId: "p1", speakerName: "Alex" },
      { participantId: "p2", speakerName: "Sam" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/transcriptFormatter.test.ts`
Expected: FAIL with "Cannot find module '../../src/knowledgeGraph/transcriptFormatter'"

- [ ] **Step 3: Write the types and the formatter**

Create `src/knowledgeGraph/knowledgeGraph.types.ts`:

```typescript
export interface DecisionCandidate {
  text: string;
  speakerName: string;
  confidence: number;
  topics: string[];
}

export interface TopicMention {
  label: string;
}

export interface ExtractionResult {
  decisions: DecisionCandidate[];
  topics: TopicMention[];
}

export interface ParticipantMention {
  participantId: string;
  speakerName: string;
}

export interface FormattedTranscript {
  promptText: string;
  participants: ParticipantMention[];
}
```

Create `src/knowledgeGraph/transcriptFormatter.ts`:

```typescript
import type { FormattedTranscript, ParticipantMention } from "./knowledgeGraph.types";

export interface TranscriptEventRow {
  participantId: string;
  speakerName: string;
  text: string;
  startTs: number;
}

export function formatTranscriptForExtraction(rows: TranscriptEventRow[]): FormattedTranscript {
  const promptText = rows.map((row) => `[${row.startTs}] ${row.speakerName}: ${row.text}`).join("\n");

  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!seen.has(row.participantId)) {
      seen.set(row.participantId, row.speakerName);
    }
  }
  const participants: ParticipantMention[] = [...seen.entries()].map(
    ([participantId, speakerName]) => ({ participantId, speakerName })
  );

  return { promptText, participants };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/transcriptFormatter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/knowledgeGraph/knowledgeGraph.types.ts src/knowledgeGraph/transcriptFormatter.ts tests/unit/transcriptFormatter.test.ts
git commit -m "Add Knowledge Graph Builder types and pure transcript formatter"
```

---

### Task 3: TranscriptFetcher

**Files:**
- Create: `src/knowledgeGraph/transcriptFetcher.ts`
- Test: `tests/integration/transcriptFetcher.integration.test.ts`

**Interfaces:**
- Consumes: `formatTranscriptForExtraction`, `TranscriptEventRow` from Task 2; `getPool` from `src/db/pool.ts`; `migrate` from `src/db/migrate.ts`.
- Produces: `class TranscriptFetcher { fetchFormattedTranscript(meetingId: string): Promise<FormattedTranscript> }`. Task 8 (`KnowledgeGraphWorker`) and Task 9 (composition root) consume this exact method signature.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/transcriptFetcher.integration.test.ts`:

```typescript
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { TranscriptFetcher } from "../../src/knowledgeGraph/transcriptFetcher";

describe("TranscriptFetcher", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it("reads a meeting's transcript_events ordered by sequence_number and formats them", async () => {
    const pool = getPool();
    const meetingId = "transcript-fetcher-test-1";
    await pool.query(
      `INSERT INTO meetings (meeting_id, started_at, status) VALUES ($1, now(), 'ended')
       ON CONFLICT (meeting_id) DO NOTHING`,
      [meetingId]
    );
    await pool.query(`DELETE FROM transcript_events WHERE meeting_id = $1`, [meetingId]);
    await pool.query(
      `INSERT INTO transcript_events
        (meeting_id, utterance_id, participant_id, speaker_name, text, start_ts, end_ts, confidence, source, sequence_number)
       VALUES
        ($1, 'u2', 'p2', 'Sam', 'Agreed.', 500, 700, 0.9, 'deepgram', 2),
        ($1, 'u1', 'p1', 'Alex', 'Let''s use Postgres.', 0, 400, 0.95, 'deepgram', 1)`,
      [meetingId]
    );

    const fetcher = new TranscriptFetcher();
    const result = await fetcher.fetchFormattedTranscript(meetingId);

    expect(result.promptText).toBe(
      "[0] Alex: Let's use Postgres.\n[500] Sam: Agreed."
    );
    expect(result.participants).toEqual([
      { participantId: "p1", speakerName: "Alex" },
      { participantId: "p2", speakerName: "Sam" },
    ]);
  });

  it("returns empty output for a meeting with no transcript events", async () => {
    const pool = getPool();
    const meetingId = "transcript-fetcher-test-empty";
    await pool.query(
      `INSERT INTO meetings (meeting_id, started_at, status) VALUES ($1, now(), 'ended')
       ON CONFLICT (meeting_id) DO NOTHING`,
      [meetingId]
    );

    const fetcher = new TranscriptFetcher();
    const result = await fetcher.fetchFormattedTranscript(meetingId);

    expect(result).toEqual({ promptText: "", participants: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/transcriptFetcher.integration.test.ts`
Expected: FAIL with "Cannot find module '../../src/knowledgeGraph/transcriptFetcher'"

- [ ] **Step 3: Write the implementation**

Create `src/knowledgeGraph/transcriptFetcher.ts`:

```typescript
import { getPool } from "../db/pool";
import { formatTranscriptForExtraction } from "./transcriptFormatter";
import type { FormattedTranscript } from "./knowledgeGraph.types";

export class TranscriptFetcher {
  async fetchFormattedTranscript(meetingId: string): Promise<FormattedTranscript> {
    const { rows } = await getPool().query(
      `SELECT participant_id AS "participantId", speaker_name AS "speakerName", text, start_ts AS "startTs"
       FROM transcript_events
       WHERE meeting_id = $1
       ORDER BY sequence_number`,
      [meetingId]
    );
    return formatTranscriptForExtraction(rows);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/transcriptFetcher.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/knowledgeGraph/transcriptFetcher.ts tests/integration/transcriptFetcher.integration.test.ts
git commit -m "Add TranscriptFetcher for the Knowledge Graph Builder"
```

---

### Task 4: DecisionExtractor

**Files:**
- Create: `src/knowledgeGraph/decisionExtractor.types.ts`
- Create: `src/knowledgeGraph/decisionExtractor.ts`
- Test: `tests/unit/decisionExtractor.test.ts`

**Interfaces:**
- Consumes: `ExtractionResult` from Task 2.
- Produces: `interface AnthropicExtractionClientLike { extract(transcriptText: string): Promise<ExtractionResult> }` (in `decisionExtractor.types.ts`); `class DecisionExtractor { constructor(client: AnthropicExtractionClientLike); extract(transcriptText: string): Promise<ExtractionResult> }`. Task 5's real client must satisfy `AnthropicExtractionClientLike`. Task 8 (`KnowledgeGraphWorker`) consumes `DecisionExtractor.extract`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/decisionExtractor.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { DecisionExtractor } from "../../src/knowledgeGraph/decisionExtractor";
import type { ExtractionResult } from "../../src/knowledgeGraph/knowledgeGraph.types";

describe("DecisionExtractor", () => {
  it("delegates to the client and returns its result", async () => {
    const extractionResult: ExtractionResult = {
      decisions: [{ text: "Use Postgres.", speakerName: "Alex", confidence: 0.9, topics: ["graph store"] }],
      topics: [{ label: "graph store" }],
    };
    const client = { extract: vi.fn().mockResolvedValue(extractionResult) };
    const extractor = new DecisionExtractor(client);

    const result = await extractor.extract("[0] Alex: Let's use Postgres.");

    expect(client.extract).toHaveBeenCalledWith("[0] Alex: Let's use Postgres.");
    expect(result).toEqual(extractionResult);
  });

  it("short-circuits to an empty result for a blank transcript without calling the client", async () => {
    const client = { extract: vi.fn() };
    const extractor = new DecisionExtractor(client);

    const result = await extractor.extract("   ");

    expect(result).toEqual({ decisions: [], topics: [] });
    expect(client.extract).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/decisionExtractor.test.ts`
Expected: FAIL with "Cannot find module '../../src/knowledgeGraph/decisionExtractor'"

- [ ] **Step 3: Write the implementation**

Create `src/knowledgeGraph/decisionExtractor.types.ts`:

```typescript
import type { ExtractionResult } from "./knowledgeGraph.types";

export interface AnthropicExtractionClientLike {
  extract(transcriptText: string): Promise<ExtractionResult>;
}
```

Create `src/knowledgeGraph/decisionExtractor.ts`:

```typescript
import type { AnthropicExtractionClientLike } from "./decisionExtractor.types";
import type { ExtractionResult } from "./knowledgeGraph.types";

export class DecisionExtractor {
  constructor(private readonly client: AnthropicExtractionClientLike) {}

  async extract(transcriptText: string): Promise<ExtractionResult> {
    if (!transcriptText.trim()) {
      return { decisions: [], topics: [] };
    }
    return this.client.extract(transcriptText);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/decisionExtractor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/knowledgeGraph/decisionExtractor.types.ts src/knowledgeGraph/decisionExtractor.ts tests/unit/decisionExtractor.test.ts
git commit -m "Add DecisionExtractor for the Knowledge Graph Builder"
```

---

### Task 5: Real Anthropic extraction client

**Files:**
- Modify: `package.json`
- Create: `src/knowledgeGraph/realAnthropicExtractionClient.ts`

**Interfaces:**
- Consumes: `AnthropicExtractionClientLike`, `ExtractionResult` from Task 4/2.
- Produces: `createRealAnthropicExtractionClient(apiKey: string): AnthropicExtractionClientLike`. Task 9 (composition root) consumes this factory function.

This file wraps the real `@anthropic-ai/sdk` and is **deliberately excluded from unit-test coverage** — it needs a live API key and a real network call, matching this repo's existing convention for "real adapter" files (`src/zoom/realRtmsClient.ts`, `src/livekit/realLiveKitRoom.ts`, etc. — see `CLAUDE.md`'s "Real vs. fake adapters" section). It is exercised only by the manual/live verification after Task 9 (a real meeting's transcript run through the real worker).

- [ ] **Step 1: Install the dependency**

Run: `npm install --force @anthropic-ai/sdk`

(`--force` is required on this Windows dev machine because `@zoom/rtms`'s own `package.json` restricts its `os` field to `linux`/`darwin` — see `CLAUDE.md`. This is unrelated to `@anthropic-ai/sdk` itself, which installs cleanly; `--force` is just what makes `npm install` proceed at all in this repo on Windows.)

- [ ] **Step 2: Write the implementation**

Create `src/knowledgeGraph/realAnthropicExtractionClient.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicExtractionClientLike } from "./decisionExtractor.types";
import type { ExtractionResult } from "./knowledgeGraph.types";

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          speakerName: { type: "string" },
          confidence: { type: "number" },
          topics: { type: "array", items: { type: "string" } },
        },
        required: ["text", "speakerName", "confidence", "topics"],
        additionalProperties: false,
      },
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" } },
        required: ["label"],
        additionalProperties: false,
      },
    },
  },
  required: ["decisions", "topics"],
  additionalProperties: false,
};

const EXTRACTION_PROMPT_PREFIX =
  "Extract every concrete decision made in this meeting transcript: the decision text, " +
  "who made it (their speaker name exactly as it appears in the transcript), your confidence " +
  "from 0 to 1, and any topics/entities it references. Also list any other standalone " +
  "topics/entities mentioned in the transcript even if not tied to a specific decision.\n\n" +
  "Transcript:\n";

export function createRealAnthropicExtractionClient(apiKey: string): AnthropicExtractionClientLike {
  const client = new Anthropic({ apiKey });

  return {
    async extract(transcriptText: string): Promise<ExtractionResult> {
      const response = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 4096,
        output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
        messages: [{ role: "user", content: buildExtractionPrompt(transcriptText) }],
      } as Anthropic.MessageCreateParams);

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      if (!textBlock) {
        throw new Error("Claude response for decision extraction contained no text block");
      }
      return JSON.parse(textBlock.text) as ExtractionResult;
    },
  };
}

function buildExtractionPrompt(transcriptText: string): string {
  return `${EXTRACTION_PROMPT_PREFIX}${transcriptText}`;
}
```

**Note for the implementer:** `output_config` may not yet be a typed field on the installed SDK version's `MessageCreateParams` (structured outputs is a newer addition) — the `as Anthropic.MessageCreateParams` cast above is there deliberately to unblock a possible type mismatch. When you run `npm run build` in Step 3, if TypeScript still rejects the shape, widen the cast to `as unknown as Anthropic.MessageCreateParams` rather than changing the request body — the wire shape (`output_config.format.schema`) is what `shared/tool-use-concepts.md`'s Structured Outputs section and the Claude API skill document as current and correct.

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: succeeds (fix any type error per the note above; do not change the request shape itself to work around a type error).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/knowledgeGraph/realAnthropicExtractionClient.ts
git commit -m "Add real Claude extraction client using forced structured JSON output"
```

---

### Task 6: GraphBuildStore

**Files:**
- Create: `src/knowledgeGraph/graphBuildStore.ts`
- Test: `tests/integration/graphBuildStore.integration.test.ts`

**Interfaces:**
- Produces: `class GraphBuildStore { findMeetingsNeedingBuild(): Promise<string[]>; markProcessing(meetingId: string): Promise<void>; markCompleted(meetingId: string): Promise<void>; markFailed(meetingId: string, error: string): Promise<void> }`. Task 8 (`KnowledgeGraphWorker`) consumes all four methods with these exact signatures.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/graphBuildStore.integration.test.ts`:

```typescript
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { GraphBuildStore } from "../../src/knowledgeGraph/graphBuildStore";

async function seedMeeting(meetingId: string, status: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM graph_builds WHERE meeting_id = $1`, [meetingId]);
  await pool.query(`DELETE FROM meetings WHERE meeting_id = $1`, [meetingId]);
  await pool.query(
    `INSERT INTO meetings (meeting_id, started_at, status) VALUES ($1, now(), $2)`,
    [meetingId, status]
  );
}

describe("GraphBuildStore", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it("returns ended meetings with no graph_builds row yet", async () => {
    await seedMeeting("graph-build-store-test-1", "ended");
    const store = new GraphBuildStore();

    const candidates = await store.findMeetingsNeedingBuild();

    expect(candidates).toContain("graph-build-store-test-1");
  });

  it("does not return active meetings", async () => {
    await seedMeeting("graph-build-store-test-active", "active");
    const store = new GraphBuildStore();

    const candidates = await store.findMeetingsNeedingBuild();

    expect(candidates).not.toContain("graph-build-store-test-active");
  });

  it("still returns a meeting stuck at processing (crash recovery)", async () => {
    await seedMeeting("graph-build-store-test-2", "ended_error");
    const store = new GraphBuildStore();
    await store.markProcessing("graph-build-store-test-2");

    const candidates = await store.findMeetingsNeedingBuild();

    expect(candidates).toContain("graph-build-store-test-2");
  });

  it("excludes a completed meeting", async () => {
    await seedMeeting("graph-build-store-test-3", "ended");
    const store = new GraphBuildStore();
    await store.markProcessing("graph-build-store-test-3");
    await store.markCompleted("graph-build-store-test-3");

    const candidates = await store.findMeetingsNeedingBuild();

    expect(candidates).not.toContain("graph-build-store-test-3");
  });

  it("excludes a failed meeting and records its error", async () => {
    await seedMeeting("graph-build-store-test-4", "ended");
    const store = new GraphBuildStore();
    await store.markProcessing("graph-build-store-test-4");
    await store.markFailed("graph-build-store-test-4", "Claude API error");

    const candidates = await store.findMeetingsNeedingBuild();
    expect(candidates).not.toContain("graph-build-store-test-4");

    const { rows } = await getPool().query(
      `SELECT status, error FROM graph_builds WHERE meeting_id = $1`,
      ["graph-build-store-test-4"]
    );
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toBe("Claude API error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/graphBuildStore.integration.test.ts`
Expected: FAIL with "Cannot find module '../../src/knowledgeGraph/graphBuildStore'"

- [ ] **Step 3: Write the implementation**

Create `src/knowledgeGraph/graphBuildStore.ts`:

```typescript
import { getPool } from "../db/pool";

export class GraphBuildStore {
  async findMeetingsNeedingBuild(): Promise<string[]> {
    const { rows } = await getPool().query(
      `SELECT m.meeting_id AS "meetingId"
       FROM meetings m
       LEFT JOIN graph_builds gb ON gb.meeting_id = m.meeting_id
       WHERE m.status IN ('ended', 'ended_error')
         AND (gb.meeting_id IS NULL OR gb.status = 'processing')`
    );
    return rows.map((row: { meetingId: string }) => row.meetingId);
  }

  async markProcessing(meetingId: string): Promise<void> {
    await getPool().query(
      `INSERT INTO graph_builds (meeting_id, status, started_at)
       VALUES ($1, 'processing', now())
       ON CONFLICT (meeting_id) DO UPDATE SET status = 'processing', started_at = now(), error = NULL`,
      [meetingId]
    );
  }

  async markCompleted(meetingId: string): Promise<void> {
    await getPool().query(
      `UPDATE graph_builds SET status = 'completed', completed_at = now() WHERE meeting_id = $1`,
      [meetingId]
    );
  }

  async markFailed(meetingId: string, error: string): Promise<void> {
    await getPool().query(
      `UPDATE graph_builds SET status = 'failed', error = $2, completed_at = now() WHERE meeting_id = $1`,
      [meetingId, error]
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/graphBuildStore.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/knowledgeGraph/graphBuildStore.ts tests/integration/graphBuildStore.integration.test.ts
git commit -m "Add GraphBuildStore for Knowledge Graph Builder idempotency and crash recovery"
```

---

### Task 7: GraphWriter

**Files:**
- Create: `src/knowledgeGraph/graphWriter.ts`
- Test: `tests/integration/graphWriter.integration.test.ts`

**Interfaces:**
- Consumes: `ExtractionResult`, `ParticipantMention` from Task 2.
- Produces: `class GraphWriter { writeGraph(meetingId: string, participants: ParticipantMention[], extraction: ExtractionResult): Promise<void> }`. Task 8 (`KnowledgeGraphWorker`) and Task 9's end-to-end test consume this exact signature.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/graphWriter.integration.test.ts`:

```typescript
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { GraphWriter } from "../../src/knowledgeGraph/graphWriter";
import type { ExtractionResult, ParticipantMention } from "../../src/knowledgeGraph/knowledgeGraph.types";

async function seedMeeting(meetingId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM meetings WHERE meeting_id = $1`, [meetingId]);
  await pool.query(
    `INSERT INTO meetings (meeting_id, started_at, ended_at, status) VALUES ($1, now(), now(), 'ended')`,
    [meetingId]
  );
}

async function countNodesByType(meetingId: string, type: string): Promise<number> {
  const pool = getPool();
  if (type === "meeting") {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM graph_nodes WHERE type = 'meeting' AND natural_key = $1`,
      [meetingId]
    );
    return rows[0].count;
  }
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM graph_nodes gn
     WHERE gn.type = $2
       AND EXISTS (
         SELECT 1 FROM graph_edges ge
         JOIN graph_nodes meeting_node ON meeting_node.type = 'meeting' AND meeting_node.natural_key = $1
         WHERE ge.type IN ('PARTICIPATED_IN', 'MADE_IN')
           AND ((ge.from_node_id = gn.id AND ge.to_node_id = meeting_node.id))
       )`,
    [meetingId, type]
  );
  return rows[0].count;
}

describe("GraphWriter", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it("writes meeting, person, decision, and topic nodes with the right edges", async () => {
    const meetingId = "graph-writer-test-1";
    await seedMeeting(meetingId);

    const participants: ParticipantMention[] = [
      { participantId: "p1", speakerName: "Alex" },
      { participantId: "p2", speakerName: "Sam" },
    ];
    const extraction: ExtractionResult = {
      decisions: [
        { text: "Use Postgres for the graph store.", speakerName: "Alex", confidence: 0.9, topics: ["graph store"] },
      ],
      topics: [{ label: "graph store" }],
    };

    const writer = new GraphWriter();
    await writer.writeGraph(meetingId, participants, extraction);

    expect(await countNodesByType(meetingId, "meeting")).toBe(1);
    expect(await countNodesByType(meetingId, "person")).toBe(2);
    expect(await countNodesByType(meetingId, "decision")).toBe(1);

    const pool = getPool();
    const { rows: decisionRows } = await pool.query(
      `SELECT id, label FROM graph_nodes WHERE type = 'decision' AND label = 'Use Postgres for the graph store.'`
    );
    expect(decisionRows).toHaveLength(1);

    const { rows: madeEdges } = await pool.query(
      `SELECT ge.id FROM graph_edges ge
       JOIN graph_nodes person ON person.id = ge.from_node_id AND person.natural_key = 'alex'
       WHERE ge.to_node_id = $1 AND ge.type = 'MADE'`,
      [decisionRows[0].id]
    );
    expect(madeEdges).toHaveLength(1);

    const { rows: mentionsEdges } = await pool.query(
      `SELECT ge.id FROM graph_edges ge
       JOIN graph_nodes topic ON topic.id = ge.to_node_id AND topic.natural_key = 'graph store'
       WHERE ge.from_node_id = $1 AND ge.type = 'MENTIONS'`,
      [decisionRows[0].id]
    );
    expect(mentionsEdges).toHaveLength(1);
  });

  it("is idempotent: writing the same meeting twice does not duplicate nodes or edges", async () => {
    const meetingId = "graph-writer-test-2";
    await seedMeeting(meetingId);

    const participants: ParticipantMention[] = [{ participantId: "p1", speakerName: "Alex" }];
    const extraction: ExtractionResult = {
      decisions: [{ text: "Ship it.", speakerName: "Alex", confidence: 0.8, topics: [] }],
      topics: [],
    };

    const writer = new GraphWriter();
    await writer.writeGraph(meetingId, participants, extraction);
    await writer.writeGraph(meetingId, participants, extraction);

    expect(await countNodesByType(meetingId, "meeting")).toBe(1);
    expect(await countNodesByType(meetingId, "person")).toBe(1);
    expect(await countNodesByType(meetingId, "decision")).toBe(1);

    const pool = getPool();
    const { rows: participatedEdges } = await pool.query(
      `SELECT ge.id FROM graph_edges ge
       JOIN graph_nodes person ON person.id = ge.from_node_id AND person.natural_key = 'alex'
       JOIN graph_nodes meeting_node ON meeting_node.id = ge.to_node_id AND meeting_node.natural_key = $1
       WHERE ge.type = 'PARTICIPATED_IN'`,
      [meetingId]
    );
    expect(participatedEdges).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/graphWriter.integration.test.ts`
Expected: FAIL with "Cannot find module '../../src/knowledgeGraph/graphWriter'"

- [ ] **Step 3: Write the implementation**

Create `src/knowledgeGraph/graphWriter.ts`:

```typescript
import type { PoolClient } from "pg";
import { getPool } from "../db/pool";
import type { ExtractionResult, ParticipantMention } from "./knowledgeGraph.types";

export class GraphWriter {
  async writeGraph(
    meetingId: string,
    participants: ParticipantMention[],
    extraction: ExtractionResult
  ): Promise<void> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");

      const meetingNodeId = await upsertNode(client, "meeting", meetingId, meetingId, {});

      // Delete any decision nodes this meeting already wrote (e.g. from a crashed,
      // now-retried build) before re-inserting -- decision nodes have no natural_key,
      // so without this cleanup a retry would duplicate every decision. FK ON DELETE
      // CASCADE removes their MADE_IN/MADE/MENTIONS edges automatically.
      await client.query(
        `DELETE FROM graph_nodes
         WHERE type = 'decision'
           AND id IN (
             SELECT from_node_id FROM graph_edges WHERE to_node_id = $1 AND type = 'MADE_IN'
           )`,
        [meetingNodeId]
      );

      const personNodeIdsBySpeakerName = new Map<string, string>();
      for (const participant of participants) {
        const naturalKey = participant.speakerName.trim().toLowerCase();
        const personNodeId = await upsertNode(client, "person", naturalKey, participant.speakerName, {});
        personNodeIdsBySpeakerName.set(participant.speakerName, personNodeId);
        await insertEdgeIfAbsent(client, personNodeId, meetingNodeId, "PARTICIPATED_IN");
      }

      const topicNodeIdsByNaturalKey = new Map<string, string>();
      for (const topic of extraction.topics) {
        const naturalKey = topic.label.trim().toLowerCase();
        const topicNodeId = await upsertNode(client, "topic", naturalKey, topic.label, {});
        topicNodeIdsByNaturalKey.set(naturalKey, topicNodeId);
      }

      for (const decision of extraction.decisions) {
        const { rows } = await client.query(
          `INSERT INTO graph_nodes (type, natural_key, label, attributes)
           VALUES ('decision', NULL, $1, $2)
           RETURNING id`,
          [decision.text, JSON.stringify({ confidence: decision.confidence })]
        );
        const decisionNodeId = rows[0].id as string;

        await insertEdgeIfAbsent(client, decisionNodeId, meetingNodeId, "MADE_IN");

        const speakerNodeId = personNodeIdsBySpeakerName.get(decision.speakerName);
        if (speakerNodeId) {
          await insertEdgeIfAbsent(client, speakerNodeId, decisionNodeId, "MADE");
        }

        for (const topicLabel of decision.topics) {
          const naturalKey = topicLabel.trim().toLowerCase();
          let topicNodeId = topicNodeIdsByNaturalKey.get(naturalKey);
          if (!topicNodeId) {
            topicNodeId = await upsertNode(client, "topic", naturalKey, topicLabel, {});
            topicNodeIdsByNaturalKey.set(naturalKey, topicNodeId);
          }
          await insertEdgeIfAbsent(client, decisionNodeId, topicNodeId, "MENTIONS");
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

async function upsertNode(
  client: PoolClient,
  type: string,
  naturalKey: string,
  label: string,
  attributes: Record<string, unknown>
): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO graph_nodes (type, natural_key, label, attributes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (type, natural_key) DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    [type, naturalKey, label, JSON.stringify(attributes)]
  );
  return rows[0].id as string;
}

async function insertEdgeIfAbsent(
  client: PoolClient,
  fromNodeId: string,
  toNodeId: string,
  type: string
): Promise<void> {
  await client.query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, type)
     VALUES ($1, $2, $3)
     ON CONFLICT (from_node_id, to_node_id, type) DO NOTHING`,
    [fromNodeId, toNodeId, type]
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/graphWriter.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/knowledgeGraph/graphWriter.ts tests/integration/graphWriter.integration.test.ts
git commit -m "Add GraphWriter with idempotent transactional node/edge upserts"
```

---

### Task 8: KnowledgeGraphWorker

**Files:**
- Create: `src/knowledgeGraph/knowledgeGraphWorker.ts`
- Test: `tests/unit/knowledgeGraphWorker.test.ts`

**Interfaces:**
- Consumes: the method signatures produced by Tasks 2, 4, 6, 7 (`GraphBuildStore`, `TranscriptFetcher`/`FormattedTranscript`, `DecisionExtractor`/`ExtractionResult`, `GraphWriter`) — expressed here as narrow `*Like` interfaces so the class is unit-testable against fakes, matching this repo's `TranscriptPipelineDeps` pattern in `src/pipeline/transcriptPipeline.ts`; also `retryWithBackoff`/`RetryConfig` from `src/lib/retry.ts` (already used the same way by `TranscriptPipeline`).
- Produces: `class KnowledgeGraphWorker { pollOnce(): Promise<void>; start(): Promise<void>; stop(): void }`. Task 9 (composition root and its end-to-end test) consumes `pollOnce`/`start`.

Per the spec's Error handling section, Postgres write failures should retry with backoff before being marked `failed` — the same treatment `TranscriptPipeline` gives its own Postgres writes via `retryWithBackoff`. Claude API failures deliberately do **not** get an extra retry layer here: `@anthropic-ai/sdk` already retries 429/5xx internally (default `max_retries: 2`), and wrapping an already-retrying call in another retry loop would multiply attempts for no benefit.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/knowledgeGraphWorker.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { KnowledgeGraphWorker } from "../../src/knowledgeGraph/knowledgeGraphWorker";

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    buildStore: {
      findMeetingsNeedingBuild: vi.fn().mockResolvedValue([]),
      markProcessing: vi.fn().mockResolvedValue(undefined),
      markCompleted: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    },
    fetcher: {
      fetchFormattedTranscript: vi.fn().mockResolvedValue({ promptText: "", participants: [] }),
    },
    extractor: {
      extract: vi.fn().mockResolvedValue({ decisions: [], topics: [] }),
    },
    writer: {
      writeGraph: vi.fn().mockResolvedValue(undefined),
    },
    onAlert: vi.fn(),
    writerRetry: { retries: 2, baseDelayMs: 1 },
    ...overrides,
  };
}

describe("KnowledgeGraphWorker", () => {
  it("does nothing when there are no candidate meetings", async () => {
    const deps = makeDeps();
    const worker = new KnowledgeGraphWorker(deps as any);

    await worker.pollOnce();

    expect(deps.buildStore.markProcessing).not.toHaveBeenCalled();
    expect(deps.fetcher.fetchFormattedTranscript).not.toHaveBeenCalled();
  });

  it("processes each candidate meeting in order: mark processing, fetch, extract, write, mark completed", async () => {
    const deps = makeDeps({
      buildStore: {
        findMeetingsNeedingBuild: vi.fn().mockResolvedValue(["m1", "m2"]),
        markProcessing: vi.fn().mockResolvedValue(undefined),
        markCompleted: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
      },
    });
    const worker = new KnowledgeGraphWorker(deps as any);

    await worker.pollOnce();

    expect(deps.buildStore.markProcessing).toHaveBeenNthCalledWith(1, "m1");
    expect(deps.buildStore.markProcessing).toHaveBeenNthCalledWith(2, "m2");
    expect(deps.fetcher.fetchFormattedTranscript).toHaveBeenCalledWith("m1");
    expect(deps.fetcher.fetchFormattedTranscript).toHaveBeenCalledWith("m2");
    expect(deps.buildStore.markCompleted).toHaveBeenCalledWith("m1");
    expect(deps.buildStore.markCompleted).toHaveBeenCalledWith("m2");
  });

  it("marks a meeting failed and alerts, without marking it completed, when extraction throws", async () => {
    const deps = makeDeps({
      buildStore: {
        findMeetingsNeedingBuild: vi.fn().mockResolvedValue(["m1"]),
        markProcessing: vi.fn().mockResolvedValue(undefined),
        markCompleted: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
      },
      extractor: { extract: vi.fn().mockRejectedValue(new Error("Claude API down")) },
    });
    const worker = new KnowledgeGraphWorker(deps as any);

    await worker.pollOnce();

    expect(deps.buildStore.markFailed).toHaveBeenCalledWith("m1", "Claude API down");
    expect(deps.buildStore.markCompleted).not.toHaveBeenCalled();
    expect(deps.onAlert).toHaveBeenCalledWith(
      expect.stringContaining("m1"),
      expect.any(Error)
    );
  });

  it("retries a failing writeGraph call before succeeding", async () => {
    const writeGraph = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(undefined);
    const deps = makeDeps({
      buildStore: {
        findMeetingsNeedingBuild: vi.fn().mockResolvedValue(["m1"]),
        markProcessing: vi.fn().mockResolvedValue(undefined),
        markCompleted: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
      },
      writer: { writeGraph },
    });
    const worker = new KnowledgeGraphWorker(deps as any);

    await worker.pollOnce();

    expect(writeGraph).toHaveBeenCalledTimes(2);
    expect(deps.buildStore.markCompleted).toHaveBeenCalledWith("m1");
    expect(deps.buildStore.markFailed).not.toHaveBeenCalled();
  });

  it("marks failed once the writer's retries are exhausted", async () => {
    const deps = makeDeps({
      buildStore: {
        findMeetingsNeedingBuild: vi.fn().mockResolvedValue(["m1"]),
        markProcessing: vi.fn().mockResolvedValue(undefined),
        markCompleted: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
      },
      writer: { writeGraph: vi.fn().mockRejectedValue(new Error("db down")) },
      writerRetry: { retries: 1, baseDelayMs: 1 },
    });
    const worker = new KnowledgeGraphWorker(deps as any);

    await worker.pollOnce();

    expect(deps.writer.writeGraph).toHaveBeenCalledTimes(2);
    expect(deps.buildStore.markFailed).toHaveBeenCalledWith("m1", "db down");
    expect(deps.buildStore.markCompleted).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/knowledgeGraphWorker.test.ts`
Expected: FAIL with "Cannot find module '../../src/knowledgeGraph/knowledgeGraphWorker'"

- [ ] **Step 3: Write the implementation**

Create `src/knowledgeGraph/knowledgeGraphWorker.ts`:

```typescript
import type { ExtractionResult, FormattedTranscript, ParticipantMention } from "./knowledgeGraph.types";
import { retryWithBackoff, type RetryConfig } from "../lib/retry";

export interface GraphBuildStoreLike {
  findMeetingsNeedingBuild(): Promise<string[]>;
  markProcessing(meetingId: string): Promise<void>;
  markCompleted(meetingId: string): Promise<void>;
  markFailed(meetingId: string, error: string): Promise<void>;
}

export interface TranscriptFetcherLike {
  fetchFormattedTranscript(meetingId: string): Promise<FormattedTranscript>;
}

export interface DecisionExtractorLike {
  extract(transcriptText: string): Promise<ExtractionResult>;
}

export interface GraphWriterLike {
  writeGraph(meetingId: string, participants: ParticipantMention[], extraction: ExtractionResult): Promise<void>;
}

export interface KnowledgeGraphWorkerDeps {
  buildStore: GraphBuildStoreLike;
  fetcher: TranscriptFetcherLike;
  extractor: DecisionExtractorLike;
  writer: GraphWriterLike;
  onAlert: (message: string, err: unknown) => void;
  pollIntervalMs?: number;
  writerRetry?: RetryConfig;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_WRITER_RETRY: RetryConfig = { retries: 3, baseDelayMs: 200 };

export class KnowledgeGraphWorker {
  private readonly pollIntervalMs: number;
  private readonly writerRetry: RetryConfig;
  private stopped = false;

  constructor(private readonly deps: KnowledgeGraphWorkerDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.writerRetry = deps.writerRetry ?? DEFAULT_WRITER_RETRY;
  }

  async pollOnce(): Promise<void> {
    const meetingIds = await this.deps.buildStore.findMeetingsNeedingBuild();
    // Sequential by design -- see Global Constraints: this is what makes including
    // 'processing'-status meetings in the candidate query safe for crash recovery
    // without ever double-processing a build genuinely still in flight.
    for (const meetingId of meetingIds) {
      await this.processMeeting(meetingId);
    }
  }

  async processMeeting(meetingId: string): Promise<void> {
    await this.deps.buildStore.markProcessing(meetingId);
    try {
      const { promptText, participants } = await this.deps.fetcher.fetchFormattedTranscript(meetingId);
      // No extra retry layer here -- @anthropic-ai/sdk already retries 429/5xx
      // internally (default max_retries: 2), so wrapping it again would just
      // multiply attempts for no benefit. See Global Constraints.
      const extraction = await this.deps.extractor.extract(promptText);
      await retryWithBackoff(
        () => this.deps.writer.writeGraph(meetingId, participants, extraction),
        this.writerRetry
      );
      await this.deps.buildStore.markCompleted(meetingId);
    } catch (err) {
      this.deps.onAlert(`graph build failed for meeting ${meetingId}`, err);
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.buildStore.markFailed(meetingId, message);
    }
  }

  async start(): Promise<void> {
    while (!this.stopped) {
      await this.pollOnce().catch((err) => this.deps.onAlert("knowledge graph poll tick failed", err));
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  stop(): void {
    this.stopped = true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/knowledgeGraphWorker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/knowledgeGraph/knowledgeGraphWorker.ts tests/unit/knowledgeGraphWorker.test.ts
git commit -m "Add KnowledgeGraphWorker orchestration loop"
```

---

### Task 9: Composition root and end-to-end integration test

**Files:**
- Create: `src/server/knowledgeGraphIndex.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Test: `tests/integration/knowledgeGraphPipeline.integration.test.ts`

**Interfaces:**
- Consumes: `KnowledgeGraphWorker` (Task 8), `GraphBuildStore` (Task 6), `TranscriptFetcher` (Task 3), `DecisionExtractor` (Task 4), `createRealAnthropicExtractionClient` (Task 5), `GraphWriter` (Task 7).
- Produces: the `npm run dev:kg` entry point; no new exported interface (this is the composition root, same role as `src/server/livekitIndex.ts`).

- [ ] **Step 1: Write the failing end-to-end test**

Create `tests/integration/knowledgeGraphPipeline.integration.test.ts`:

```typescript
import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { GraphBuildStore } from "../../src/knowledgeGraph/graphBuildStore";
import { TranscriptFetcher } from "../../src/knowledgeGraph/transcriptFetcher";
import { GraphWriter } from "../../src/knowledgeGraph/graphWriter";
import { KnowledgeGraphWorker } from "../../src/knowledgeGraph/knowledgeGraphWorker";
import type { ExtractionResult } from "../../src/knowledgeGraph/knowledgeGraph.types";

describe("Knowledge Graph Builder end-to-end pipeline", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it("processes an ended meeting's real transcript into a real graph, then skips it on the next poll", async () => {
    const meetingId = "kg-pipeline-test-1";
    const pool = getPool();
    await pool.query(`DELETE FROM graph_builds WHERE meeting_id = $1`, [meetingId]);
    await pool.query(`DELETE FROM transcript_events WHERE meeting_id = $1`, [meetingId]);
    await pool.query(`DELETE FROM meetings WHERE meeting_id = $1`, [meetingId]);
    await pool.query(
      `INSERT INTO meetings (meeting_id, started_at, ended_at, status) VALUES ($1, now(), now(), 'ended')`,
      [meetingId]
    );
    await pool.query(
      `INSERT INTO transcript_events
        (meeting_id, utterance_id, participant_id, speaker_name, text, start_ts, end_ts, confidence, source, sequence_number)
       VALUES
        ($1, 'u1', 'p1', 'Alex', 'Let''s use Postgres for the graph store.', 0, 400, 0.95, 'deepgram', 1),
        ($1, 'u2', 'p2', 'Sam', 'Agreed.', 500, 700, 0.9, 'deepgram', 2)`,
      [meetingId]
    );

    const extractionResult: ExtractionResult = {
      decisions: [
        { text: "Use Postgres for the graph store.", speakerName: "Alex", confidence: 0.9, topics: ["graph store"] },
      ],
      topics: [{ label: "graph store" }],
    };
    const fakeExtractor = { extract: vi.fn().mockResolvedValue(extractionResult) };

    const worker = new KnowledgeGraphWorker({
      buildStore: new GraphBuildStore(),
      fetcher: new TranscriptFetcher(),
      extractor: fakeExtractor,
      writer: new GraphWriter(),
      onAlert: (msg, err) => console.error(msg, err),
    });

    await worker.pollOnce();

    const { rows: buildRows } = await pool.query(
      `SELECT status FROM graph_builds WHERE meeting_id = $1`,
      [meetingId]
    );
    expect(buildRows[0].status).toBe("completed");

    const { rows: decisionRows } = await pool.query(
      `SELECT label FROM graph_nodes WHERE type = 'decision' AND label = 'Use Postgres for the graph store.'`
    );
    expect(decisionRows).toHaveLength(1);
    expect(fakeExtractor.extract).toHaveBeenCalledTimes(1);

    // A second poll tick must not reprocess a completed meeting.
    await worker.pollOnce();
    expect(fakeExtractor.extract).toHaveBeenCalledTimes(1);
    const { rows: decisionRowsAfterSecondPoll } = await pool.query(
      `SELECT label FROM graph_nodes WHERE type = 'decision' AND label = 'Use Postgres for the graph store.'`
    );
    expect(decisionRowsAfterSecondPoll).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/knowledgeGraphPipeline.integration.test.ts`
Expected: FAIL — depends only on already-existing modules (Tasks 3/6/7/8), so if Tasks 1–8 are complete this should actually PASS already. Confirm by running it; if it fails, the failure points at a real bug in one of the earlier tasks to fix before continuing (this test is the integration check for all of them together).

- [ ] **Step 3: Add the composition root**

Add to `.env.example` (after the `LIVEKIT_HTTP_PORT=8081` line):

```
ANTHROPIC_API_KEY=
KG_POLL_INTERVAL_MS=5000
```

Add to `package.json`'s `"scripts"` object (after `"dev:livekit": "tsx src/server/livekitIndex.ts",`):

```json
    "dev:kg": "tsx src/server/knowledgeGraphIndex.ts",
```

Create `src/server/knowledgeGraphIndex.ts`:

```typescript
import "dotenv/config";
import { KnowledgeGraphWorker } from "../knowledgeGraph/knowledgeGraphWorker";
import { GraphBuildStore } from "../knowledgeGraph/graphBuildStore";
import { TranscriptFetcher } from "../knowledgeGraph/transcriptFetcher";
import { DecisionExtractor } from "../knowledgeGraph/decisionExtractor";
import { createRealAnthropicExtractionClient } from "../knowledgeGraph/realAnthropicExtractionClient";
import { GraphWriter } from "../knowledgeGraph/graphWriter";

async function startKnowledgeGraphWorker(): Promise<void> {
  const worker = new KnowledgeGraphWorker({
    buildStore: new GraphBuildStore(),
    fetcher: new TranscriptFetcher(),
    extractor: new DecisionExtractor(
      createRealAnthropicExtractionClient(process.env.ANTHROPIC_API_KEY!)
    ),
    writer: new GraphWriter(),
    onAlert: (message, err) => console.error(message, err),
    pollIntervalMs: Number(process.env.KG_POLL_INTERVAL_MS ?? 5000),
  });

  console.log("Knowledge Graph worker started, polling for ended meetings...");
  await worker.start();
}

startKnowledgeGraphWorker().catch((err) => {
  console.error("failed to start Knowledge Graph worker", err);
  process.exit(1);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/knowledgeGraphPipeline.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Full suite and type-check**

Run: `npm run build`
Expected: succeeds with no type errors.

Run: `npm test`
Expected: all tests pass (existing sub-project 1 tests plus every test added in this plan).

- [ ] **Step 6: Commit**

```bash
git add src/server/knowledgeGraphIndex.ts package.json .env.example tests/integration/knowledgeGraphPipeline.integration.test.ts
git commit -m "Wire the Knowledge Graph worker into a composition root (npm run dev:kg)"
```

---

## Manual/live verification (not automated — do after all tasks above are committed)

Per the spec's success criteria: run a real LiveKit meeting (`npm run dev:livekit`) with actual conversation containing a clear decision or two, set `ANTHROPIC_API_KEY` in `.env`, run `npm run dev:kg` alongside it, let the meeting end, and after `KG_POLL_INTERVAL_MS` has elapsed, query directly:

```sql
SELECT gn.label, gn.attributes FROM graph_nodes gn WHERE gn.type = 'decision';
SELECT p.label AS person, d.label AS decision FROM graph_edges e
  JOIN graph_nodes p ON p.id = e.from_node_id AND p.type = 'person'
  JOIN graph_nodes d ON d.id = e.to_node_id AND d.type = 'decision'
  WHERE e.type = 'MADE';
```

Confirm the extracted decisions and speaker attribution match what was actually said.
