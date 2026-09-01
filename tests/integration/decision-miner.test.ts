import { it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import { createDecision, type CoreDeps } from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const A = '00000000-0000-0000-0000-0000000000aa';
const UA = '00000000-0000-0000-0000-0000000000a1';

let tdb: TestDb;
let db: DbHandle;
let deps: CoreDeps;

const llm: LlmProviders = {
  chat: { model: 'test-model', complete: async () => ({ text: '{"claims":[]}', usage: { inputTokens: 0, outputTokens: 0 } }) },
  embeddings: { model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, dim: 1024, embed: async (texts: string[]) => texts.map(() => Array(1024).fill(0.1)) },
  rerank: { model: 'r', rerank: async () => [] },
} as unknown as LlmProviders;

beforeAll(async () => {
  tdb = await startTestDb();
  db = createDb(tdb.appUrl);
  deps = { db, llm };
  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'a@x.com' }, 'id', 'email')}`;
}, 180_000);
afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('0005 applied: mined_artifact table and new columns exist', async () => {
  const cols = await tdb.admin`
    select table_name, column_name from information_schema.columns
    where table_name in ('artifact','decision_record','connection','mined_artifact')
      and column_name in ('state','merged_closed_at','origin','mine_watermark','content_hash')`;
  const set = new Set(cols.map((c: any) => `${c.table_name}.${c.column_name}`));
  expect(set.has('artifact.state')).toBe(true);
  expect(set.has('artifact.merged_closed_at')).toBe(true);
  expect(set.has('decision_record.origin')).toBe(true);
  expect(set.has('connection.mine_watermark')).toBe(true);
  expect(set.has('mined_artifact.content_hash')).toBe(true);
});

it('createDecision persists origin=suggested', async () => {
  const { id } = await createDecision(deps, A, { title: 'x', decision: 'y', origin: 'suggested', sourceRef: '#9' });
  const row = await tdb.admin`select origin from decision_record where id = ${id}`;
  expect(row[0]!.origin).toBe('suggested');
});
