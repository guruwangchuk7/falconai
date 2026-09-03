# In-Meeting Decision Listener Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a finished paired meeting into drafted, cited, unconfirmed Decision Records in the existing Ship-1 queue — post-meeting extraction over the full transcript, with attendee-gated verbatim evidence and a per-record visibility tier.

**Architecture:** A meeting-end trigger in the session-worker assembles the finalized transcript from the Redis event log into a durable **working copy** (Postgres, short TTL) and enqueues a `meeting-extract` BullMQ job. The job chunks the transcript, calls the extended `extractDecisions` spotter (which now returns **utterance-index spans**), runs a targeted rationale pass, resolves spans to `{speaker, ts, text}`, and creates `origin='meeting'` records with attendee-gated spans. Read paths enforce a two-tier visibility model (workspace-visible human-authored summary vs. attendee-gated verbatim spans) as defense-in-depth on top of the §12.9 RLS tenant floor. Confirmation and delivery reuse Ship 1's `/decisions` queue plus a post-call notification.

**Tech Stack:** TypeScript (Node 24, ESM), Drizzle + Postgres (pgvector, RLS), BullMQ + Redis, Fastify/ws session-worker, Next.js 15 web, pinned Claude Haiku (digest tier) behind `deps.llm`, Vitest + Testcontainers.

## Global Constraints

_Copied verbatim from the spec + CLAUDE.md; every task's requirements implicitly include this section._

- **Text-only.** Falcon never emits audio; this feature writes records, never speaks (PRD §3.2).
- **Raw audio never stored.** The working copy is **transcript text only**, never audio (§12.3/R6).
- **Provenance gate.** A created record's `sourceRef` is the `meetingId`, **never** any value the model emits in its JSON (same rule as `handleMine`, F7.2).
- **Tenant isolation at the DB layer.** Every new table has Postgres RLS keyed on `app.workspace_id`; every query runs through `withTenant`. App-layer per-record filtering is defense-in-depth, **never** the isolation floor (§12.9).
- **Confirmed-only grounding.** Only `status='confirmed'` records ground answers; unconfirmed/superseded/`attendees_only`-to-non-attendee are status-visible at most, never citable (F10.1/R23).
- **Verbal agreement never auto-confirms.** Records are created `unconfirmed`; a human confirms one-click (R23).
- **Pin model versions**, never `-latest`; extraction uses the existing pinned `DIGEST_MODEL` via `deps.llm.chat` (§12.8).
- **Migration discipline (recurring repo finding):** every new migration file MUST be added to `packages/db/package.json`'s `migrate` script AND to `tests/support/pg.ts`'s `startTestDb`, or real-DB tests break.
- **Workflow:** branch → PR → `gh` merge; never commit to `main`. PowerShell is the shell; `gh` is at `C:\Program Files\GitHub CLI\gh.exe` (full path).
- **Spec:** `docs/superpowers/specs/2026-09-02-in-meeting-decision-listener-design.md` (decisions D1–D15).

---

## Plan-Set Overview — five sequential sub-phases

This spec spans data model → session-worker → extraction → read-path ACL → web. Each phase produces working, testable software and is gated on the previous one's interfaces. **Phase A is written to full TDD granularity below.** Phases B–E are specified as task + file + interface roadmaps; each is expanded into full TDD steps **just before it executes**, so its code reflects the *actual* signatures the prior phase produced rather than guessed ones.

| Phase | Deliverable | Depends on |
|---|---|---|
| **A. Data model & config** | Migration 0006 (meeting, decision_span, meeting_transcript, mined_meeting; decision_record.visibility+participants; workspace.meeting_retention_days) + RLS + schema + config constants | — |
| **B. Meeting-end trigger + working copy** | session-worker assembles transcript → durable working copy → snapshots attendees → enqueues `MeetingExtractJob` | A |
| **C. Extraction pipeline** | `extractDecisions` returns index spans; `handleMeetingExtract` (chunk → extract → validate → dedup → rationale pass → resolve → create) + `mined_meeting` ledger | A, B |
| **D. Two-tier visibility + row-level ACL + D15** | attendee-gated span reads; visibility-tier retrieval; cross-tier supersede status-only projection; one-way widening | A, C |
| **E. Web surface** | confirm-time visibility selector (required) + span-display gating; `/decisions?meetingId=`; delivery (address-one + informational + zero-decision + escalation); meeting citation | A–D |

**Calibration (post-impl, gated, not a phase):** `DECISION_MEETING_MIN_CONFIDENCE` is calibrated on a labeled **meeting** corpus via the evals harness (mirroring Ship 2's shadow discipline) against written-down accept criteria before the miner enforces. The constant ships PROVISIONAL.

---

## Phase A — Data model & config foundation

**Files:**
- Create: `packages/db/drizzle/0006_in_meeting_listener.sql`
- Modify: `packages/db/src/schema.ts` (append new tables + columns)
- Modify: `packages/db/package.json:8` (register 0006 in `migrate`)
- Modify: `tests/support/pg.ts` (apply 0006 in `startTestDb`)
- Modify: `packages/config/src/index.ts` (append constants)
- Test: `tests/integration/meeting-schema-rls.test.ts`

### Task A1: Migration 0006 + schema + wiring + tenant-isolation test

One migration file, one reviewable unit (mirrors how `0005_decision_miner.sql` shipped four related changes together). Deliverable: the full data model exists and is tenant-isolated on every new table.

**Interfaces:**
- Consumes: existing `withTenant` (RLS via `app.workspace_id`), the `startTestDb` harness (`admin`, `appUrl`), the `0005` RLS-policy pattern.
- Produces (Drizzle table objects other phases import from `@falcon/db` `schema`): `schema.meeting`, `schema.decisionSpan`, `schema.meetingTranscript`, `schema.minedMeeting`; new columns `schema.decisionRecord.visibility` (`'workspace'|'attendees_only'`, default `'workspace'`), `schema.decisionRecord.participants` (jsonb), `schema.workspace.meetingRetentionDays` (int, default 0 = off).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/meeting-schema-rls.test.ts`. It seeds two workspaces as admin, then asserts (a) the new tables exist with expected defaults and (b) an app-role (`withTenant`) connection scoped to workspace A cannot read workspace B's rows — the §12.9 floor on every new table.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { startTestDb, type TestDb } from '../support/pg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const M0006 = resolve(HERE, '../../packages/db/drizzle/0006_in_meeting_listener.sql');

let tdb: TestDb;
let app: ReturnType<typeof postgres>;
const WS_A = '11111111-1111-1111-1111-111111111111';
const WS_B = '22222222-2222-2222-2222-222222222222';

beforeAll(async () => {
  tdb = await startTestDb();
  await tdb.admin.unsafe(readFileSync(M0006, 'utf8')); // idempotent; startTestDb will also apply it once wired (Step 4)
  // Seed one meeting per workspace as admin (bypasses RLS).
  for (const ws of [WS_A, WS_B]) {
    await tdb.admin`insert into workspace (id, name) values (${ws}, ${'ws-' + ws.slice(0, 4)}) on conflict do nothing`;
    await tdb.admin`insert into meeting (workspace_id, session_id, ended_at, attendees)
                    values (${ws}, gen_random_uuid(), now(), ${tdb.admin.json([])})`;
  }
  app = postgres(tdb.appUrl, { prepare: false });
}, 120_000);

afterAll(async () => { await app?.end(); await tdb?.stop(); });

async function asTenant<T>(ws: string, fn: (sql: typeof app) => Promise<T>): Promise<T> {
  await app`select set_config('app.workspace_id', ${ws}, true)`;
  return fn(app);
}

it('meeting is tenant-isolated: workspace A cannot see workspace B rows', async () => {
  const rows = await asTenant(WS_A, (sql) => sql`select workspace_id from meeting`);
  expect(rows.length).toBe(1);
  expect(rows[0]!.workspace_id).toBe(WS_A);
});

it('decision_record.visibility defaults to workspace', async () => {
  const [col] = await tdb.admin`
    select column_default from information_schema.columns
    where table_name = 'decision_record' and column_name = 'visibility'`;
  expect(String(col!.column_default)).toContain('workspace');
});

it('workspace.meeting_retention_days defaults to 0 (retention off)', async () => {
  const [col] = await tdb.admin`
    select column_default from information_schema.columns
    where table_name = 'workspace' and column_name = 'meeting_retention_days'`;
  expect(String(col!.column_default)).toContain('0');
});

it('decision_span and meeting_transcript and mined_meeting exist and are RLS-forced', async () => {
  const rows = await tdb.admin`
    select relname from pg_class
    where relname in ('decision_span','meeting_transcript','mined_meeting') and relrowsecurity and relforcerowsecurity`;
  expect(rows.map((r) => r.relname).sort()).toEqual(['decision_span', 'meeting_transcript', 'mined_meeting']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/integration/meeting-schema-rls.test.ts`
Expected: FAIL — `0006_in_meeting_listener.sql` does not exist (ENOENT on `readFileSync`).

- [ ] **Step 3: Write the migration**

Create `packages/db/drizzle/0006_in_meeting_listener.sql`. Follows the `0005` RLS pattern exactly (enable + force + tenant policy per new table). All `add column` are `if not exists` and all `create table` are `if not exists`, so the file is idempotent (a hard requirement for the shared `startTestDb`).

```sql
-- In-Meeting Decision Listener (feature 005 / post-meeting capture). Adds: the meeting object with an
-- attendee snapshot + retention marker; the durable working-copy transcript; attendee-gated decision
-- spans; the per-record visibility tier + participants; the per-workspace retention setting; and the
-- mine-once meeting ledger. See docs/superpowers/specs/2026-09-02-in-meeting-decision-listener-design.md.

-- 1) per-record visibility tier (D13) + participants snapshot (D12). Default 'workspace' so existing
--    behaviour is unchanged; 'attendees_only' gates the summary to the snapshotted attendee set.
alter table decision_record add column if not exists visibility text not null default 'workspace'
  check (visibility in ('workspace','attendees_only'));
alter table decision_record add column if not exists participants jsonb;

-- 2) per-workspace retention setting (D6). 0 = OFF (working copy discarded after extraction).
alter table workspace add column if not exists meeting_retention_days integer not null default 0;

-- 3) the meeting object. session_id ties back to the Phase-3 session; attendees is the immutable
--    snapshot (D12) [{ userId, displayName, isMember, isFalconUser }]; transcript_retained_until is
--    null when discarded (D6), so a reader knows whether "go read more" is possible.
create table if not exists meeting (
  id                        uuid not null default gen_random_uuid(),
  workspace_id              uuid not null,
  session_id                uuid not null,
  title                     text,
  started_at                timestamptz,
  ended_at                  timestamptz not null default now(),
  attendees                 jsonb not null,
  designated_reviewer_user_id uuid,
  transcript_retained_until timestamptz,
  created_at                timestamptz not null default now(),
  primary key (workspace_id, id)
);
alter table meeting enable row level security;
alter table meeting force row level security;
create policy meeting_tenant_isolation on meeting
  using (workspace_id = current_setting('app.workspace_id', true)::uuid)
  with check (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- 4) the durable working-copy transcript (D7). TRANSCRIPT TEXT ONLY, never audio (R6). One row per
--    meeting; expires_at is the short working-copy TTL, independent of the retention setting.
create table if not exists meeting_transcript (
  workspace_id  uuid not null,
  meeting_id    uuid not null,
  utterances    jsonb not null,   -- [{ idx, speaker, userId, text, tsMs }]
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, meeting_id)
);
alter table meeting_transcript enable row level security;
alter table meeting_transcript force row level security;
create policy meeting_transcript_tenant_isolation on meeting_transcript
  using (workspace_id = current_setting('app.workspace_id', true)::uuid)
  with check (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- 5) decision spans (D4/D9). The attendee-gated verbatim evidence: resolved text, not indices.
--    RLS here is TENANT-level only; attendee gating is enforced app-side (Phase D) as defense-in-depth.
create table if not exists decision_span (
  id            uuid not null default gen_random_uuid(),
  workspace_id  uuid not null,
  decision_id   uuid not null,
  kind          text not null check (kind in ('decision','rationale')),
  speaker       text,
  ts_ms         bigint,
  utterance_idx integer,
  text          text not null,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists decision_span_decision_idx on decision_span (workspace_id, decision_id);
alter table decision_span enable row level security;
alter table decision_span force row level security;
create policy decision_span_tenant_isolation on decision_span
  using (workspace_id = current_setting('app.workspace_id', true)::uuid)
  with check (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- 6) mine-once meeting ledger (D7). No content_hash (unlike mined_artifact): a finalized transcript is
--    IMMUTABLE, so (workspace_id, meeting_id) + extractor_version fully identifies the work.
--    transcript_retained_until records whether a future re-mine is even possible (D6 ledger-honesty).
create table if not exists mined_meeting (
  workspace_id       uuid not null,
  meeting_id         uuid not null,
  mined_at           timestamptz not null default now(),
  result             text not null check (result in ('suggested','no_decision','error','deferred')),
  extractor_version  text not null,
  transcript_retained_until timestamptz,
  decision_id        uuid,
  max_candidate_score real,
  primary key (workspace_id, meeting_id)
);
alter table mined_meeting enable row level security;
alter table mined_meeting force row level security;
create policy mined_meeting_tenant_isolation on mined_meeting
  using (workspace_id = current_setting('app.workspace_id', true)::uuid)
  with check (workspace_id = current_setting('app.workspace_id', true)::uuid);
```

- [ ] **Step 4: Add the Drizzle table definitions + wire the migration**

Append to `packages/db/src/schema.ts` (after `minedArtifact`, ~line 137). Use the same imports already in the file (`pgTable, uuid, text, jsonb, timestamp, integer, bigint, real, primaryKey`):

```ts
// ---------- In-Meeting Decision Listener (0006_in_meeting_listener.sql) ----------

export const meeting = pgTable('meeting', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  title: text('title'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull().defaultNow(),
  attendees: jsonb('attendees').notNull(),                 // [{ userId, displayName, isMember, isFalconUser }]
  designatedReviewerUserId: uuid('designated_reviewer_user_id'),
  transcriptRetainedUntil: timestamp('transcript_retained_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.id] }) }));

export const meetingTranscript = pgTable('meeting_transcript', {
  workspaceId: uuid('workspace_id').notNull(),
  meetingId: uuid('meeting_id').notNull(),
  utterances: jsonb('utterances').notNull(),               // [{ idx, speaker, userId, text, tsMs }]
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.meetingId] }) }));

export const decisionSpan = pgTable('decision_span', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  decisionId: uuid('decision_id').notNull(),
  kind: text('kind').notNull(),                            // decision | rationale
  speaker: text('speaker'),
  tsMs: bigint('ts_ms', { mode: 'number' }),
  utteranceIdx: integer('utterance_idx'),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.id] }) }));

export const minedMeeting = pgTable('mined_meeting', {
  workspaceId: uuid('workspace_id').notNull(),
  meetingId: uuid('meeting_id').notNull(),
  minedAt: timestamp('mined_at', { withTimezone: true }).notNull().defaultNow(),
  result: text('result').notNull(),                        // suggested | no_decision | error | deferred
  extractorVersion: text('extractor_version').notNull(),
  transcriptRetainedUntil: timestamp('transcript_retained_until', { withTimezone: true }),
  decisionId: uuid('decision_id'),
  maxCandidateScore: real('max_candidate_score'),
}, (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.meetingId] }) }));
```

Add the two new `decisionRecord` columns inside the existing `decisionRecord` definition (after `origin`, line 100):

```ts
  visibility: text('visibility').notNull().default('workspace'), // D13: workspace | attendees_only
  participants: jsonb('participants'),                           // D12: [{ userId, displayName }]
```

Add the `workspace` column (locate `export const workspace = pgTable('workspace', {` and append inside):

```ts
  meetingRetentionDays: integer('meeting_retention_days').notNull().default(0), // D6: 0 = off
```

Register the migration in `packages/db/package.json:8` — append to the `migrate` script:

```
 -f drizzle/0006_in_meeting_listener.sql
```

Wire it into `tests/support/pg.ts` (mirror the `MIGRATION_MINER` block): add a `MIGRATION_LISTENER` const resolving `0006_in_meeting_listener.sql` and a fourth `await admin.unsafe(readFileSync(MIGRATION_LISTENER, 'utf8'));` after the miner line (line 44). Then remove the now-redundant explicit apply in the test's `beforeAll` (Step 1) — leave a comment noting `startTestDb` applies it, matching the 0004/0005 convention.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/integration/meeting-schema-rls.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 6: Typecheck**

Run: `pnpm -r typecheck`
Expected: PASS (new `schema.*` exports resolve; no unused-import errors).

- [ ] **Step 7: Commit**

```bash
git add packages/db/drizzle/0006_in_meeting_listener.sql packages/db/src/schema.ts packages/db/package.json tests/support/pg.ts tests/integration/meeting-schema-rls.test.ts
git commit -m "feat(005-listener): migration 0006 — meeting, spans, working copy, visibility tier, ledger + RLS"
```

### Task A2: Config constants

**Files:**
- Modify: `packages/config/src/index.ts` (append after line 92)
- Test: `tests/unit/meeting-config.test.ts`

**Interfaces:**
- Produces: `DECISION_MEETING_MIN_CONFIDENCE`, `MEETING_RATIONALE_PASS_TOP_N`, `MEETING_WORKING_COPY_TTL_HOURS`, `MEETING_REVIEWER_ESCALATION_HOURS` (imported by Phases B/C/E).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/meeting-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DECISION_MEETING_MIN_CONFIDENCE, MEETING_RATIONALE_PASS_TOP_N,
  MEETING_WORKING_COPY_TTL_HOURS, MEETING_REVIEWER_ESCALATION_HOURS,
} from '@falcon/config';

it('meeting constants are conservative + provisional', () => {
  expect(DECISION_MEETING_MIN_CONFIDENCE).toBeGreaterThanOrEqual(0.7); // strict until calibrated
  expect(MEETING_RATIONALE_PASS_TOP_N).toBeGreaterThan(0);
  expect(MEETING_WORKING_COPY_TTL_HOURS).toBeGreaterThanOrEqual(24);
  expect(MEETING_WORKING_COPY_TTL_HOURS).toBeLessThanOrEqual(72);
  expect(MEETING_REVIEWER_ESCALATION_HOURS).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/meeting-config.test.ts`
Expected: FAIL — exports do not exist.

- [ ] **Step 3: Add the constants**

Append to `packages/config/src/index.ts`:

```ts
/**
 * In-Meeting Decision Listener (feature 005 / post-meeting capture). PROVISIONAL — the confidence
 * cutoff MUST be calibrated on a labeled MEETING corpus (spoken/disfluent input is harder than PRs)
 * before the listener enforces, mirroring Ship 2's shadow discipline. Strict until then.
 */
export const DECISION_MEETING_MIN_CONFIDENCE = 0.75; // suggest-time cutoff on candidate.score
export const MEETING_RATIONALE_PASS_TOP_N = 3;       // cap the targeted rationale pass (cost lever, spec §13)
export const MEETING_WORKING_COPY_TTL_HOURS = 48;    // durable working-copy TTL, in [24,72] (D7)
export const MEETING_REVIEWER_ESCALATION_HOURS = 36; // reviewer inaction → notify all attendees (spec §7)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/meeting-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/index.ts tests/unit/meeting-config.test.ts
git commit -m "feat(005-listener): provisional meeting extraction constants"
```

---

## Phase B — Meeting-end trigger + working copy _(roadmap; expand to TDD before executing)_

**Files:**
- Create: `apps/session-worker/src/meeting-end.ts` — `assembleAndEnqueue(deps, sessionId, workspaceId)`: replay `utterance_final` events (via `createEventLog(redis, sessionId).readFrom(null)`) into an ordered `utterances[]` (assign global `idx`, carry `userId`/`speaker`/`text`/`tsMs`); `createMeeting(...)`; `persistWorkingCopy(...)` with `expiresAt = now + MEETING_WORKING_COPY_TTL_HOURS`; snapshot attendees from `sessionMembership`; enqueue `MeetingExtractJob`.
- Modify: `apps/session-worker/src/server.ts` — handle an `end_meeting` control message (any participant ends it for all; others told why); idle-disconnect fallback with a **rejoin grace window**; **session-length cap**. On terminal end, call `assembleAndEnqueue` exactly once (idempotency guard on `meetingId`/`sessionId`).
- Create: `packages/queue/src/*` additions — `meetingExtractQueue()`, `meetingExtractJobId(workspaceId, meetingId)`, `MeetingExtractJob` type. (Follow the existing `mineQueue`/`mineJobId` pattern in `@falcon/queue`.)
- Create: `packages/core/src/meeting.ts` — `createMeeting`, `persistWorkingCopy`, `readWorkingCopy`, `snapshotAttendees` (all `withTenant`).

**Interfaces:**
- Consumes: `createEventLog` (`readFrom`), `schema.sessionMembership`, Phase-A `schema.meeting`/`meetingTranscript`, `MEETING_WORKING_COPY_TTL_HOURS`.
- Produces: `MeetingExtractJob = { workspaceId: string; meetingId: string }`; `createMeeting(deps, workspaceId, input) => { meetingId }`; `readWorkingCopy(deps, workspaceId, meetingId) => { utterances: Utterance[] } | null` where `Utterance = { idx: number; speaker: string | null; userId: string | null; text: string; tsMs: number }`.

**Key tasks & tests:**
1. Queue + job type (unit: `meetingExtractJobId` is stable/coalescing per meeting).
2. `createMeeting` + attendee snapshot (integration/RLS: attendees frozen; tenant-isolated).
3. `persistWorkingCopy`/`readWorkingCopy` round-trip with `expiresAt` set; **assert no audio field is ever written** (R6).
4. `assembleAndEnqueue`: replays events in order, assigns stable global `idx`, enqueues exactly one job (idempotent on meetingId).
5. Trigger in `server.ts`: explicit `end_meeting` ends for all; idle+grace does **not** split a reconnect within the window into a second meeting; session-length cap fires. (Integration over the ws server, mirroring `tests/integration/ws-client-worker.test.ts`.)

## Phase C — Extraction pipeline _(roadmap; expand to TDD before executing)_

**Files:**
- Modify: `packages/core/src/decision-extract.ts` — extend `ScoredCandidate` with `decisionSpans: number[]` and `rationaleSpans: number[]` (utterance indices); update `PROMPT` to render `[u{idx}] speaker: text` lines and to return the indices it used; bump `EXTRACTOR_VERSION` naturally (it hashes `PROMPT`). Keep the input-agnostic contract — PR mining passes single-index segments, unaffected.
- Create: `packages/core/src/meeting-extract.ts` — `chunkUtterances(utterances, size)`; `dedupeBySpanOverlap(candidates)`; `rationalePass(deps, candidate, fullUtterances)` (top-N only); `resolveSpans(candidate, utterances) => Span[]` with **index validation** (out-of-range → throw to the error path; no valid decision span → drop).
- Modify: `apps/worker/src/handlers.ts` — add `handleMeetingExtract(deps, { workspaceId, meetingId })` mirroring `handleMine`: ledger gate (no contentHash — immutable), budget gate (reserved lane), chunked extract, dedup, rationale pass, resolve, `createDecision(origin:'meeting', sourceRef: meetingId, spans, participants, ownerHint, visibility:'workspace')`, `no_decision` ledger row on empty, `recordMinedMeeting`.
- Create: `packages/core/src/meeting-ledger.ts` — `getMinedMeeting`, `recordMinedMeeting` (mirror `getMinedRow`/`recordMined`).
- Modify: `apps/worker/src/index.ts` — register the `meeting-extract` worker.

**Interfaces:**
- Consumes: Phase-B `readWorkingCopy`, `MeetingExtractJob`; `extractDecisions` (extended); `createDecision` (extended in Phase D to accept `spans`/`visibility`/`participants` — sequence Phase D's `createDecision` signature change *before* wiring here, or stub then fill).
- Produces: `handleMeetingExtract(...) => { result: MineResult; decisionIds: string[] }`; persisted `decision_span` rows; `mined_meeting` ledger rows.

**Key tasks & tests:** out-of-range index → error path (not silent drop); no decision span → no candidate; dedup collapses differently-titled duplicates sharing a decision-span index; rationale pass recovers a rationale deliberately placed in a different chunk; resolved spans persisted as `{speaker, ts, text}`; zero-decision writes a `no_decision` ledger row; job idempotent on `meetingId + extractorVersion`; provenance — `sourceRef` is `meetingId`, never model output.

## Phase D — Two-tier visibility + row-level ACL + D15 _(roadmap; expand to TDD before executing)_

**Files:**
- Modify: `packages/core/src/decisions.ts` — extend `CreateDecisionInput` with `visibility?`, `participants?`, `spans?`; write spans inside the `createDecision` tx. Add `isAttendee(record, userId)` helper (reads snapshot). Add `getDecisionSpans(deps, workspaceId, decisionId, viewerUserId)` that returns spans **only if** viewer ∈ attendees, else `[]`. Add `setVisibility(deps, workspaceId, id, 'workspace')` enforcing **one-way** widening (reject `workspace → attendees_only`). Make `getDecision`/`listQueue`/detail **tier-aware** (a non-attendee never receives `attendees_only` content, nor any verbatim spans).
- Modify: `packages/core/src/answer.ts` — retrieval excludes `attendees_only` records from non-attendees entirely; grounds non-attendees on the **summary** only; implements **D15**: a `workspace` record superseded by an `attendees_only` one returns the status-only projection ("superseded by a decision you don't have access to"), never the stale record and never empty.
- Modify: web read routes (`apps/web/app/(dashboard)/decisions/[id]/page.tsx`, history/answer routes) to pass `viewerUserId` and hide gated spans.

**Interfaces:**
- Consumes: Phase-A `decisionSpan`, `decisionRecord.visibility`/`participants`; Phase-C span writes.
- Produces: `getDecisionSpans(...viewerUserId) => Span[]`; tier-aware `getDecision`/`answerQuestion`.

**Key tasks & tests — the §12 ACL battery (write these first):** non-attendee member cannot read spans by **any** path incl. the answer/citation path; `attendees_only` record invisible (decision + summary) to non-attendee on every read path; attendee who left the workspace excluded; new joiner sees `workspace` summary + history, not spans; **cross-tier supersede (D15)** never grounds stale + never returns "nothing on record"; **widening is one-way**; RLS tenant floor still returns nothing cross-tenant.

## Phase E — Web surface _(roadmap; expand to TDD before executing)_

**Files:**
- Modify: `apps/web` decisions confirm route + UI — **required, explicit** visibility selector (`workspace` pre-selected) at summary-edit prominence (not skippable); required summary review; owner-hint shown **non-authoritatively** (D14); span panel rendered only for attendees.
- Modify: `/decisions` list — accept `?meetingId=` filter; "Suggested from *Meeting · time*" badge; meeting-citation link on the detail view.
- Create: delivery/notification path — on `handleMeetingExtract` completion: **actionable to the designated reviewer**, **informational to other attendees**, **informational-to-all on zero decisions**, **escalation to all after `MEETING_REVIEWER_ESCALATION_HOURS`**; instrument **median queue age for meeting-sourced records** separately.
- Modify: consent copy surfaces (§9) — working-copy 72h + attendee-gated disclosures, gated by the §12.4 two-party-consent toggle.

**Interfaces:**
- Consumes: Phase-D tier-aware reads/`getDecisionSpans`; Phase-A `meeting`; Phase-C outcomes.
- Produces: the confirm + delivery UX; the meeting-filtered queue.

**Key tasks & tests:** confirm rejected without an explicit visibility choice; escalation fires after the window; zero-decision still notifies + writes `no_decision`; span panel hidden for a non-attendee viewer (e2e); citation resolves to the meeting.

---

## Self-Review

**Spec coverage (D1–D15):** D1/D2 → Phase C (post-meeting job into the Ship-1 queue). D3 → Phase E delivery. D4/D9 → Phase C spans + validation. D5 → Phase D (dismiss deletes spans — add explicit task in Phase D expansion). D6 → Phase A `meeting_retention_days` + `transcript_retained_until`; retention on/off branch in Phase C. D7 → Phase A `meeting_transcript` + Phase B working copy + idempotent enqueue. D8 → Phase B trigger. D10/D12/D13 → Phase A columns + Phase D enforcement + Phase E selector. D11 (reserved budget lane) → Phase C budget gate. D14 → Phase C `ownerHint` + Phase E non-authoritative display. D15 → Phase D projection. Testing §12 → Phase D battery. Cost §13 → `MEETING_RATIONALE_PASS_TOP_N` (A2) + Phase C top-N. **Gap noted:** the retention on→off **working-copy deletion/promotion** step and the **dismiss→span-delete** step must appear as explicit tasks when Phases C and D are expanded — flagged here so they aren't lost.

**Placeholder scan:** Phase A contains complete SQL/TS/test code and exact commands. Phases B–E are intentionally roadmap-level (file + interface + task list), to be expanded to full TDD steps just-in-time — this is the skill's prescribed decomposition for a multi-subsystem spec, not a placeholder within an executable task.

**Type consistency:** `Utterance` (Phase B) fields (`idx/speaker/userId/text/tsMs`) match the `meeting_transcript.utterances` shape (A1) and the `decision_span` columns (`utterance_idx/ts_ms/speaker/text`). `MeetingExtractJob = { workspaceId, meetingId }` is consistent across B/C. `MineResult` reused from Ship 2 for `mined_meeting.result`. `visibility` values (`workspace`/`attendees_only`) match the CHECK constraint, the Drizzle default, and Phase D/E usage.
