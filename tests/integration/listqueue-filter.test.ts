// Feature 005 (Decision Memory / listener) — `listQueue`'s optional `sourceRef` filter. Same
// deps/seed harness as decision-memory.test.ts. Real Postgres with RLS; Docker required.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import { createDecision, listQueue, type CoreDeps } from '@falcon/core';
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

it('listQueue filters by sourceRef when provided, else returns all unconfirmed', async () => {
  await createDecision(deps, WS_A, { title: 'FromMeeting', decision: 'd', origin: 'meeting', sourceRef: 'meeting:m1' });
  await createDecision(deps, WS_A, { title: 'FromPR', decision: 'd', origin: 'suggested', sourceRef: 'pr:9' });
  const all = await listQueue(deps, WS_A);
  const m1 = await listQueue(deps, WS_A, 100, 'meeting:m1');
  expect(all.length).toBeGreaterThanOrEqual(2);
  expect(m1.every((r) => r.sourceRef === 'meeting:m1')).toBe(true);
  expect(m1.some((r) => r.title === 'FromMeeting')).toBe(true);
});
