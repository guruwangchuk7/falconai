// Task C3 (feature 005 / In-Meeting Decision Listener) — the plain-persistence half of the two-tier
// model. Extends `createDecision` so a meeting-sourced record can carry its visibility tier, attendee
// snapshot, and evidence spans, all inserted in the SAME tenant transaction. Security-critical READ
// gating (attendee-only enforcement) is Phase D — this test only proves the write path persists the
// data. Docker required (real Postgres + RLS via `withTenant`).
import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDb, type DbHandle } from '@falcon/db';
import { schema } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import { createDecision, type CoreDeps } from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const M2 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');

const WS_A = '00000000-0000-0000-0000-0000000000aa';

let tdb: TestDb;
let db: DbHandle;

const llm: LlmProviders = {
  chat: { model: 'test-model', complete: async () => ({ text: '{"claims":[]}', usage: { inputTokens: 0, outputTokens: 0 } }) },
  embeddings: { model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, dim: 1024, embed: async (texts: string[]) => texts.map(() => Array(1024).fill(0.1)) },
  rerank: { model: 'r', rerank: async () => [] },
} as unknown as LlmProviders;

let deps: CoreDeps;

beforeAll(async () => {
  tdb = await startTestDb();
  await tdb.admin.unsafe(readFileSync(M2, 'utf8'));
  db = createDb(tdb.appUrl);
  deps = { db, llm };
  await tdb.admin`insert into workspace ${tdb.admin({ id: WS_A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('persists visibility + participants + decision_span rows in one tx', async () => {
  const participants = [{ userId: 'u1', displayName: 'Guru' }, { userId: 'u2', displayName: 'Sarah' }];
  const { id } = await createDecision(deps, WS_A, {
    title: 'Adopt Postgres', decision: 'Use Postgres over SQLite', origin: 'meeting',
    sourceRef: 'meeting:m1', visibility: 'attendees_only', participants,
    spans: [
      { kind: 'decision', utteranceIdx: 31, speaker: 'Sarah', tsMs: 240000, text: 'okay, postgres then' },
      { kind: 'rationale', utteranceIdx: 12, speaker: 'Guru', tsMs: 1000, text: 'the concurrency thing kills sqlite' },
    ],
  });

  // Record columns (read as tenant).
  const rec = await deps.db.withTenant(WS_A, async (tx) =>
    (await tx.select().from(schema.decisionRecord).where(eq(schema.decisionRecord.id, id)).limit(1))[0]);
  expect(rec!.visibility).toBe('attendees_only');
  expect(rec!.origin).toBe('meeting');
  expect((rec!.participants as any[])).toHaveLength(2);

  // Span rows. Read as superuser (tdb.admin) — bypasses RLS. This assertion only cares that the
  // rows were persisted, not attendee-ACL semantics (that's the D1 security battery's job, and the
  // 0008 RESTRICTIVE policy means a plain withTenant span read now returns zero rows).
  const spans = await tdb.admin`select * from decision_span where decision_id = ${id}`;
  expect(spans).toHaveLength(2);
  expect(spans.find((s) => s.kind === 'decision')!.utterance_idx).toBe(31);
  expect(spans.find((s) => s.kind === 'rationale')!.text).toContain('concurrency');
});

it('defaults visibility to workspace and writes no spans when none given (back-compat)', async () => {
  const { id } = await createDecision(deps, WS_A, { title: 'Manual', decision: 'x' });
  const rec = await deps.db.withTenant(WS_A, async (tx) =>
    (await tx.select().from(schema.decisionRecord).where(eq(schema.decisionRecord.id, id)).limit(1))[0]);
  expect(rec!.visibility).toBe('workspace');
  const spans = await tdb.admin`select * from decision_span where decision_id = ${id}`;
  expect(spans).toHaveLength(0);
});
