// Task D1 (feature 005 / In-Meeting Decision Listener) — the security battery for the DB-layer
// attendee gate on verbatim decision spans. Raw meeting speech is the confidentiality boundary
// (§9.3/§12.3): visible ONLY to the meeting's snapshotted attendees, even to other workspace
// members. Enforced as a RESTRICTIVE RLS policy (0008) that ANDs with the 0006 tenant policy.
// Fail-closed: no viewer context -> zero spans. Docker required (real Postgres + RLS).
import { it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, type DbHandle, schema } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import { createDecision, type CoreDeps } from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const WS_A = '00000000-0000-0000-0000-0000000000aa';
const WS_B = '00000000-0000-0000-0000-0000000000bb';
const ATTENDEE = '00000000-0000-0000-0000-0000000000a1';
const OUTSIDER = '00000000-0000-0000-0000-0000000000b2';

let tdb: TestDb;
let db: DbHandle;

const llm: LlmProviders = {
  chat: { model: 'test-model', complete: async () => ({ text: '{"claims":[]}', usage: { inputTokens: 0, outputTokens: 0 } }) },
  embeddings: { model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, dim: 1024, embed: async (texts: string[]) => texts.map(() => Array(1024).fill(0.1)) },
  rerank: { model: 'r', rerank: async () => [] },
} as unknown as LlmProviders;

let deps: CoreDeps;
let decisionId: string;

beforeAll(async () => {
  tdb = await startTestDb();
  db = createDb(tdb.appUrl);
  deps = { db, llm };
  await tdb.admin`insert into workspace ${tdb.admin({ id: WS_A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into workspace ${tdb.admin({ id: WS_B, name: 'B', settings: {} }, 'id', 'name', 'settings')}`;

  const { id } = await createDecision(deps, WS_A, {
    title: 'Postgres', decision: 'Adopt Postgres', origin: 'meeting', sourceRef: 'meeting:m1',
    visibility: 'workspace',
    participants: [{ userId: ATTENDEE, displayName: 'Guru', isMember: true, isFalconUser: true }],
    spans: [{ kind: 'decision', utteranceIdx: 31, speaker: 'Sarah', tsMs: 240000, text: 'okay, postgres then' }],
  });
  decisionId = id;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('an ATTENDEE (via withViewer) can read the spans', async () => {
  const spans = await deps.db.withViewer(WS_A, ATTENDEE, async (tx) =>
    tx.select().from(schema.decisionSpan).where(eq(schema.decisionSpan.decisionId, decisionId)));
  expect(spans).toHaveLength(1);
  expect(spans[0]!.text).toContain('postgres');
});

it('a NON-ATTENDEE workspace member (via withViewer) sees ZERO spans', async () => {
  const spans = await deps.db.withViewer(WS_A, OUTSIDER, async (tx) =>
    tx.select().from(schema.decisionSpan).where(eq(schema.decisionSpan.decisionId, decisionId)));
  expect(spans).toHaveLength(0);
});

it('a read with NO viewer context (plain withTenant) sees ZERO spans (fail-closed)', async () => {
  const spans = await deps.db.withTenant(WS_A, async (tx) =>
    tx.select().from(schema.decisionSpan).where(eq(schema.decisionSpan.decisionId, decisionId)));
  expect(spans).toHaveLength(0);
});

it('cross-tenant: an attendee viewer in WS_B sees ZERO (tenant floor holds)', async () => {
  const spans = await deps.db.withViewer(WS_B, ATTENDEE, async (tx) =>
    tx.select().from(schema.decisionSpan).where(eq(schema.decisionSpan.decisionId, decisionId)));
  expect(spans).toHaveLength(0);
});
