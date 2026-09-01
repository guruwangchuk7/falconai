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
  EXTRACTOR_VERSION,
  listQueue,
  type CoreDeps,
} from '@falcon/core';
import { handleMine } from '../../apps/worker/src/handlers.js';
import { startTestDb, type TestDb } from '../support/pg.js';

const A = '00000000-0000-0000-0000-0000000000aa';
const UA = '00000000-0000-0000-0000-0000000000a1';

let tdb: TestDb;
let db: DbHandle;
let deps: CoreDeps;

// Mutable canned chat response for the decision-miner tests below (like `cannedAnswer` in
// decision-memory.test.ts). Tasks 4/5 tests in this file use embeddings, not chat, so this
// default (empty candidates) never affects them.
let cannedChat = '{"candidates":[]}';
// When true, the fake chat provider throws to simulate a transient upstream (network/5xx/429) error.
let chatThrows = false;

const llm: LlmProviders = {
  chat: { model: 'test-model', complete: async () => {
    if (chatThrows) throw new Error('transient upstream');
    return { text: cannedChat, usage: { inputTokens: 0, outputTokens: 0 } };
  } },
  embeddings: { model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, dim: 1024, embed: async (texts: string[]) => texts.map(() => Array(1024).fill(0.1)) },
  rerank: { model: 'r', rerank: async () => [] },
} as unknown as LlmProviders;

// Seed an artifact row via admin (bypasses RLS) so handleMine can load it.
async function seedArtifact(id: string, title: string, body: string) {
  await tdb.admin`insert into artifact ${tdb.admin({
    id, workspace_id: A, user_id: UA, source: 'github', external_ref: '#' + id.slice(-2),
    type: 'pr', title, body, acl_tags: [], trust_tier: 'trusted', state: 'merged', merged_closed_at: new Date(),
  })}`;
}

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

it('listQueue exposes origin so the UI can badge suggested items', async () => {
  await createDecision(deps, A, { title: 'From a PR', decision: 'd', origin: 'suggested', sourceRef: '#123' });
  const q = await listQueue(deps, A);
  const item = q.find((i) => i.sourceRef === '#123');
  expect(item && (item as any).origin).toBe('suggested');
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

it('mines a clear decision into an unconfirmed suggested record + suggested ledger row', async () => {
  cannedChat = '{"candidates":[{"title":"Adopt Postgres","decision":"Use Postgres over Mongo","rationale":"ops","score":0.92}]}';
  const art = '00000000-0000-0000-0000-0000000000c1';
  await seedArtifact(art, 'Switch DB to Postgres', 'We chose Postgres.');
  const out = await handleMine(deps, { workspaceId: A, artifactId: art });
  expect(out.result).toBe('suggested');
  const rec = await tdb.admin`select origin, status, source_ref from decision_record where id = ${out.decisionIds[0]!}`;
  expect(rec[0]).toMatchObject({ origin: 'suggested', status: 'unconfirmed' });
  const led = await tdb.admin`select result, extractor_version from mined_artifact where artifact_id = ${art}`;
  expect(led[0]).toMatchObject({ result: 'suggested', extractor_version: EXTRACTOR_VERSION });
});

it('provenance gate: ignores a sourceRef the model emits, uses the artifact ref', async () => {
  cannedChat = '{"candidates":[{"title":"Rogue","decision":"x","sourceRef":"#HACK","score":0.9}]}';
  const art = '00000000-0000-0000-0000-0000000000c2';
  await seedArtifact(art, 'Some PR', 'body');
  const out = await handleMine(deps, { workspaceId: A, artifactId: art });
  const rec = await tdb.admin`select source_ref from decision_record where id = ${out.decisionIds[0]!}`;
  expect(rec[0]!.source_ref).toBe('#c2'); // the seeded artifact's external_ref, never the model's '#HACK'
});

it('re-mining the same artifact+version+hash is a skip (no dup)', async () => {
  cannedChat = '{"candidates":[{"title":"Adopt Redis","decision":"Use Redis","score":0.9}]}';
  const art = '00000000-0000-0000-0000-0000000000c3';
  await seedArtifact(art, 'Add Redis', 'We chose Redis.');
  const first = await handleMine(deps, { workspaceId: A, artifactId: art });
  const second = await handleMine(deps, { workspaceId: A, artifactId: art });
  expect(first.result).toBe('suggested');
  expect(second.decisionIds).toEqual([]); // skipped by ledger
});

it('below-threshold candidate → no_decision with max score recorded', async () => {
  cannedChat = '{"candidates":[{"title":"Maybe","decision":"weak","score":0.4}]}';
  const art = '00000000-0000-0000-0000-0000000000c4';
  await seedArtifact(art, 'Weak', 'body');
  const out = await handleMine(deps, { workspaceId: A, artifactId: art });
  expect(out.result).toBe('no_decision');
  const led = await tdb.admin`select max_candidate_score from mined_artifact where artifact_id = ${art}`;
  expect(Number(led[0]!.max_candidate_score)).toBeCloseTo(0.4);
});

it('within-run duplicate candidates (same normalized title) dedup to a single decision record', async () => {
  cannedChat = '{"candidates":[{"title":"Adopt Redis","decision":"Use Redis for caching","score":0.9},{"title":"Adopt Redis","decision":"Use Redis for caching too","score":0.9}]}';
  const art = '00000000-0000-0000-0000-0000000000c6';
  await seedArtifact(art, 'Add Redis cache', 'We chose Redis.');
  const out = await handleMine(deps, { workspaceId: A, artifactId: art });
  expect(out.result).toBe('suggested');
  expect(out.decisionIds.length).toBe(1);
  const rows = await tdb.admin`select id from decision_record where source_ref = ${'#' + art.slice(-2)}`;
  expect(rows.length).toBe(1);
});

it('transient extractor error THROWS (BullMQ retry) and writes NO ledger row — artifact stays re-minable', async () => {
  const art = '00000000-0000-0000-0000-0000000000c5';
  await seedArtifact(art, 'Flaky', 'body');
  chatThrows = true;
  try {
    await expect(handleMine(deps, { workspaceId: A, artifactId: art })).rejects.toThrow();
    const led = await tdb.admin`select artifact_id from mined_artifact where artifact_id = ${art}`;
    expect(led.length).toBe(0); // no terminal 'error' row → ledger gate won't skip the retry
  } finally {
    chatThrows = false; // don't leak the throwing provider into later tests
  }
});
