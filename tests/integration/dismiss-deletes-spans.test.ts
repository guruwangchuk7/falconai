// D5 fix verification (final-review Fix 1): dismissDecision must delete the decision_span rows in the
// same transaction, not just tombstone the parent record — otherwise a dismissed meeting excerpt's
// verbatim speech persists forever, which is exactly what "dismiss" is supposed to prevent (§9).
import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import { createDecision, dismissDecision, type CoreDeps } from '@falcon/core';
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

it('dismissing a meeting record deletes its decision_span rows (D5)', async () => {
  const { id } = await createDecision(deps, WS_A, {
    title: 'Doomed', decision: 'd', origin: 'meeting', sourceRef: 'meeting:x',
    participants: [{ userId: 'u1', displayName: 'G', isMember: true, isFalconUser: true }],
    spans: [{ kind: 'decision', utteranceIdx: 1, speaker: 'G', tsMs: 1, text: 'secret words' }],
  });
  // spans exist (read as admin — bypasses the attendee RLS)
  expect((await tdb.admin`select 1 from decision_span where decision_id = ${id}`).length).toBe(1);
  const res = await dismissDecision(deps, WS_A, id);
  expect(res.dismissed).toBe(true);
  expect((await tdb.admin`select 1 from decision_span where decision_id = ${id}`).length).toBe(0); // GONE
});

it('a non-meeting record (no participants, no spans) still dismisses cleanly via withTenant', async () => {
  const { id } = await createDecision(deps, WS_A, { title: 'Manual', decision: 'm', origin: 'manual', sourceRef: '#1' });
  const res = await dismissDecision(deps, WS_A, id); // no attendee viewer needed; must not throw
  expect(res.dismissed).toBe(true);
});
