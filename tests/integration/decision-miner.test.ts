import { it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import {
  createDecision,
  dismissDecision,
  recordMined,
  getMinedRow,
  isSuppressed,
  countSuggestionsToday,
  normalizeTitle,
  type CoreDeps,
} from '@falcon/core';
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

it('ledger round-trips and dedups on (workspace, artifact)', async () => {
  const art = '00000000-0000-0000-0000-0000000000f1';
  await recordMined(deps, A, art, { result: 'no_decision', extractorVersion: 'v1', contentHash: 'h1', maxCandidateScore: 0.4 });
  const row = await getMinedRow(deps, A, art);
  expect(row).toEqual({ extractorVersion: 'v1', contentHash: 'h1', result: 'no_decision' });
});

it('isSuppressed matches an existing record by sourceRef + normalized title (any status incl dismissed)', async () => {
  const { id } = await createDecision(deps, A, { title: 'Use Postgres.', decision: 'pg', origin: 'suggested', sourceRef: '#77' });
  await dismissDecision(deps, A, id);
  expect(await isSuppressed(deps, A, '#77', normalizeTitle('use postgres'))).toBe(true);
  expect(await isSuppressed(deps, A, '#77', normalizeTitle('totally different'))).toBe(false);
});

it('countSuggestionsToday counts only today\'s origin=suggested rows', async () => {
  const before = await countSuggestionsToday(deps, A);
  await createDecision(deps, A, { title: 'Budget probe', decision: 'z', origin: 'suggested', sourceRef: '#88' });
  expect(await countSuggestionsToday(deps, A)).toBe(before + 1);
});
