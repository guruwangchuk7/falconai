// Feature 005 (Decision Memory) US1 — the WRITE PATH against real Postgres with RLS. Capture creates
// an `unconfirmed` record that is NOT retrievable; confirm (the human-in-the-loop gate) makes it
// retrievable; a grounded answer then cites it with a link to its detail view. LLM claims are canned;
// retrieval, ACL, RLS, the confirmed-only filter, and embed-on-create are REAL. Docker required.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import {
  answerQuestion, searchDecisions, createDecision, confirmDecision, listQueue, getDecision,
  supersedeDecision, dismissDecision, matchUnconfirmedCandidates,
  type CoreDeps,
} from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const M2 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');

const A = '00000000-0000-0000-0000-0000000000aa';
const B = '00000000-0000-0000-0000-0000000000bb';
const UA = '00000000-0000-0000-0000-0000000000a1';

let tdb: TestDb;
let db: DbHandle;
let cannedAnswer = '{"claims":[]}';

const llm: LlmProviders = {
  chat: { model: 'test-model', complete: async () => ({ text: cannedAnswer, usage: { inputTokens: 0, outputTokens: 0 } }) },
  embeddings: { model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, dim: 1024, embed: async (texts: string[]) => texts.map(() => Array(1024).fill(0.1)) },
  rerank: { model: 'r', rerank: async () => [] },
} as unknown as LlmProviders;

let deps: CoreDeps;

beforeAll(async () => {
  tdb = await startTestDb();
  await tdb.admin.unsafe(readFileSync(M2, 'utf8')); // query_event/answer tables the answer path writes (0004/dismissed_at is applied by startTestDb)
  db = createDb(tdb.appUrl);
  deps = { db, llm };
  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into workspace ${tdb.admin({ id: B, name: 'B', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'a@x.com' }, 'id', 'email')}`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('capture stores an unconfirmed, embedded record that is NOT retrievable (FR-007)', async () => {
  const { id } = await createDecision(deps, A, { title: 'Adopt Deepgram as primary STT', decision: 'Deepgram Nova', rationale: 'accuracy', sourceRef: '#17' });
  expect(id).toBeTruthy();

  const detail = await getDecision(deps, A, id);
  expect(detail!.status).toBe('unconfirmed');

  const queue = await listQueue(deps, A);
  expect(queue.map((q) => q.id)).toContain(id);

  const results = await searchDecisions(deps, A, 'speech to text provider', 10);
  expect(results.map((r) => r.id)).not.toContain(id); // unconfirmed → not retrievable
});

it('confirm makes it retrievable and stamps the confirmer (FR-003); idempotent', async () => {
  const { id } = await createDecision(deps, A, { title: 'Use pgvector for embeddings', decision: 'pgvector' });
  const first = await confirmDecision(deps, A, id, UA);
  expect(first.status).toBe('confirmed');
  const again = await confirmDecision(deps, A, id, UA);
  expect(again.status).toBe('already_final'); // no state regression

  const detail = await getDecision(deps, A, id);
  expect(detail!.status).toBe('confirmed');
  expect(detail!.confirmedBy).toBe(UA);
  expect(detail!.confirmedAt).toBeTruthy();

  const results = await searchDecisions(deps, A, 'embedding storage', 10);
  expect(results.map((r) => r.id)).toContain(id);

  const queue = await listQueue(deps, A);
  expect(queue.map((q) => q.id)).not.toContain(id); // left the queue
});

it('a confirmed decision grounds an answer, cited with a link to its detail view (US1/T019)', async () => {
  const { id } = await createDecision(deps, A, { title: 'Text-only output', decision: 'Falcon never speaks aloud' });
  await confirmDecision(deps, A, id, UA);

  cannedAnswer = '{"claims":[{"text":"Falcon is text-only.","citations":[1]}]}';
  const a = await answerQuestion(deps, { workspaceId: A, requesterUserId: UA, question: 'do we output audio?' });
  expect(a.status).toBe('grounded');
  const cite = a.claims[0]!.citations[0]!;
  expect(cite.type).toBe('decision');
  expect(cite.url).toBe(`/decisions/${cite.artifactId}`); // clickable detail link, not null
});

it('tenant isolation: workspace B cannot see or confirm A\'s decision (SC-005/FR-017)', async () => {
  const { id } = await createDecision(deps, A, { title: 'A-only decision', decision: 'private' });
  expect(await getDecision(deps, B, id)).toBeNull();       // RLS: no cross-tenant read
  const res = await confirmDecision(deps, B, id, UA);
  expect(res.status).toBe('not_found');                     // RLS: no row to confirm from B
  expect((await getDecision(deps, A, id))!.status).toBe('unconfirmed'); // unchanged
});

it('US3: supersede flips the old record out of retrieval and links the chain both ways (R23)', async () => {
  const { id: oldId } = await createDecision(deps, A, { title: 'DB choice: MongoDB', decision: 'MongoDB' });
  await confirmDecision(deps, A, oldId, UA);
  const { id: newId } = await createDecision(deps, A, { title: 'DB choice: Postgres', decision: 'Postgres' });
  await confirmDecision(deps, A, newId, UA);

  const res = await supersedeDecision(deps, A, { newRecordId: newId, supersedesId: oldId });
  expect(res.superseded).toBe(true);

  const ids = (await searchDecisions(deps, A, 'database choice', 20)).map((r) => r.id);
  expect(ids).toContain(newId);       // current decision retrievable
  expect(ids).not.toContain(oldId);   // reversed decision never surfaces as live

  const oldDetail = (await getDecision(deps, A, oldId))!;
  expect(oldDetail.status).toBe('superseded');
  expect(oldDetail.supersededById).toBe(newId);            // chain forward
  expect((await getDecision(deps, A, newId))!.supersedesId).toBe(oldId); // chain back

  expect((await supersedeDecision(deps, A, { newRecordId: newId, supersedesId: oldId })).superseded).toBe(false); // idempotent
});

it('US3: a second supersede of an already-superseded record does NOT branch the chain (no dangling pointer)', async () => {
  // Regression: supersedeDecision must not write newRecord.supersedesId unless it actually won the
  // old-record flip. Otherwise two records can both point at the same predecessor -> the chain forks
  // and a forward walk (getDecision.supersededById / the timeline) silently picks one branch.
  const { id: oldId } = await createDecision(deps, A, { title: 'Cache: Memcached', decision: 'Memcached' });
  await confirmDecision(deps, A, oldId, UA);
  const { id: first } = await createDecision(deps, A, { title: 'Cache: Redis', decision: 'Redis' });
  await confirmDecision(deps, A, first, UA);
  const { id: second } = await createDecision(deps, A, { title: 'Cache: KeyDB', decision: 'KeyDB' });
  await confirmDecision(deps, A, second, UA);

  expect((await supersedeDecision(deps, A, { newRecordId: first, supersedesId: oldId })).superseded).toBe(true);
  // `second` also tries to supersede the SAME old record — the flip already happened, so this must fail
  // AND leave `second` unlinked (not carrying a dangling supersedesId to the old record).
  expect((await supersedeDecision(deps, A, { newRecordId: second, supersedesId: oldId })).superseded).toBe(false);

  expect((await getDecision(deps, A, oldId))!.supersededById).toBe(first); // single successor — no fork
  expect((await getDecision(deps, A, second))!.supersedesId).toBeNull();   // loser wrote no pointer
  expect((await getDecision(deps, A, first))!.supersedesId).toBe(oldId);
});

it('US4: dismiss tombstones an unconfirmed candidate; it never grounds or surfaces again (FR-005)', async () => {
  const { id } = await createDecision(deps, A, { title: 'Maybe adopt Bun', decision: 'Bun?', sourceRef: '#99' });
  expect((await listQueue(deps, A)).map((q) => q.id)).toContain(id);

  const res = await dismissDecision(deps, A, id);
  expect(res.dismissed).toBe(true);

  expect((await listQueue(deps, A)).map((q) => q.id)).not.toContain(id);          // gone from the queue
  expect((await matchUnconfirmedCandidates(deps, A, 'javascript runtime', 10)).map((m) => m.id)).not.toContain(id); // never a status hint
  const detail = (await getDecision(deps, A, id))!;
  expect(detail.dismissedAt).toBeTruthy();
  expect(detail.status).toBe('unconfirmed');                // dismiss is orthogonal to the lifecycle

  expect((await dismissDecision(deps, A, id)).dismissed).toBe(false); // idempotent
});

it('US4: a confirmed decision cannot be dismissed (lifecycle guard)', async () => {
  const { id } = await createDecision(deps, A, { title: 'Locked decision', decision: 'final' });
  await confirmDecision(deps, A, id, UA);
  expect((await dismissDecision(deps, A, id)).dismissed).toBe(false);
  expect((await getDecision(deps, A, id))!.dismissedAt).toBeNull();
});

it('review #3: a title-only record cannot be confirmed (no empty decision becomes evidence)', async () => {
  const { id } = await createDecision(deps, A, { title: 'We should pick a database' }); // no decision text
  expect((await confirmDecision(deps, A, id, UA)).status).toBe('missing_decision');
  expect((await getDecision(deps, A, id))!.status).toBe('unconfirmed');               // stays out of the index
  expect((await searchDecisions(deps, A, 'database', 20)).map((r) => r.id)).not.toContain(id);
});
