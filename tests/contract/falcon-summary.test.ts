// Phase 2 (spec 002-personal-falcon, T022) — route-level contract test for the summary + edit
// surface. This exercises the REAL Next route handlers (POST /api/falcon/summary and
// PATCH /api/falcon/answers/[id]) against REAL Postgres with RLS enforced (falcon_app role).
// Only the external seams are faked: the auth session, the app deps() singleton (pointed at the
// testcontainer + a canned LLM), the rate limiter, and observability. Docker required.
//
// Covers contracts/api.md test 6 (edit becomes authoritative) + test 7 (exactly one query_event
// per summary), plus the ownership 404 and honest 400/401 the route promises.
import { it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import type { CoreDeps } from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

// --- Mutable test state referenced by the hoisted module mocks (set in beforeAll). ---
const h = vi.hoisted(() => ({
  session: null as { userId: string; workspaceId: string } | null,
  deps: null as unknown as CoreDeps,
}));

vi.mock('@/lib/session', () => ({ getActiveSession: async () => h.session }));
vi.mock('@/lib/deps', () => ({
  deps: () => h.deps,
  secrets: () => { throw new Error('secrets() not used in this test'); },
}));
vi.mock('@falcon/queue', () => ({ rateLimit: async () => ({ ok: true, remaining: 999 }) }));
vi.mock('@falcon/observability', () => ({ captureException: () => {}, captureEvent: () => {} }));

// Imported AFTER the mocks above are hoisted, so the handlers pick up the fakes.
import { POST as summaryPOST } from '@/app/api/falcon/summary/route';
import { PATCH as answerPATCH } from '@/app/api/falcon/answers/[id]/route';

const HERE = dirname(fileURLToPath(import.meta.url));
const M2 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');

const A = '00000000-0000-0000-0000-0000000000aa';
const UA = '00000000-0000-0000-0000-0000000000a1';
const UB = '00000000-0000-0000-0000-0000000000b1';
const ART = '00000000-0000-0000-0000-0000000000f1';
const VEC = `[${Array(1024).fill(0.1).join(',')}]`;

let tdb: TestDb;
let db: DbHandle;
// Deterministic LLM: retrieval ranks by the constant 0.1 vector (sim 1 to the seeded chunk);
// the chat "completion" is whatever cannedAnswer is set to for the test.
let cannedAnswer = '{"claims":[]}';
const llm: LlmProviders = {
  chat: { model: 'test-model', complete: async () => ({ text: cannedAnswer, usage: { inputTokens: 0, outputTokens: 0 } }) },
  embeddings: { model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, dim: 1024, embed: async () => [Array(1024).fill(0.1)] },
  rerank: { model: 'r', rerank: async () => [] },
} as unknown as LlmProviders;

const summaryReq = (body: unknown) =>
  new Request('http://test/api/falcon/summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const patchReq = (body: unknown) =>
  new Request('http://test/api/falcon/answers/x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  tdb = await startTestDb();
  await tdb.admin.unsafe(readFileSync(M2, 'utf8'));
  db = createDb(tdb.appUrl);
  h.deps = { db, llm } as CoreDeps;

  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'a@x.com' }, 'id', 'email')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UB, email: 'b@x.com' }, 'id', 'email')}`;

  // UA owns one auth-related artifact + chunk in repo-a (grounds the summary).
  await tdb.admin`insert into artifact (id, workspace_id, user_id, source, external_ref, type, title, acl_tags, trust_tier, source_updated_at, last_synced_at)
    values (${ART}, ${A}, ${UA}, 'github', 'sha1', 'commit', 'auth commit', '["repo-a"]'::jsonb, 'trusted', now(), now())`;
  await tdb.admin`insert into artifact_chunk (workspace_id, artifact_id, chunk_index, content, trust_tier, embedding, embedding_model, embedding_version)
    values (${A}, ${ART}, 0, 'implemented the GitHub auth callback', 'trusted', ${VEC}::vector, ${EMBEDDING_MODEL}, ${EMBEDDING_VERSION})`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('T022: POST /summary → grounded, cited, and persisted as kind=summary with one query_event (tests 6/7)', async () => {
  h.session = { userId: UA, workspaceId: A };
  cannedAnswer = '{"claims":[{"text":"You implemented the GitHub auth callback.","citations":[1]}]}';

  const res = await summaryPOST(summaryReq({ topic: 'authentication' }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    answerId: string;
    status: string;
    claims: Array<{ citations: Array<{ artifactId: string }> }>;
  };
  expect(body.status).toBe('grounded');
  expect(body.claims.length).toBeGreaterThan(0);
  for (const c of body.claims) expect(c.citations.length).toBeGreaterThan(0); // ≥1 citation per rendered claim
  expect(body.claims[0]!.citations[0]!.artifactId).toBe(ART);

  // Persistence: the question is kind=summary, the answer + its citation exist, and EXACTLY ONE
  // query_event with kind=summary was written for this ask (test 7 / SC-005 retention integrity).
  const q = await tdb.admin`select kind from question where id = (select question_id from answer where id = ${body.answerId})`;
  expect(q[0]!.kind).toBe('summary');
  const cites = await tdb.admin`select count(*)::int as n from answer_citation where answer_id = ${body.answerId}`;
  expect(cites[0]!.n).toBeGreaterThan(0);
  const ev = await tdb.admin`select count(*)::int as n from query_event where user_id = ${UA} and kind = 'summary'`;
  expect(ev[0]!.n).toBe(1);
});

it('T022: PATCH /answers/{id} → editedText becomes authoritative for the owner (test 6)', async () => {
  h.session = { userId: UA, workspaceId: A };
  const [answerRow] = await tdb.admin`select a.id from answer a join question q on q.id = a.question_id where q.user_id = ${UA} limit 1`;
  const answerId = answerRow!.id as string;

  const res = await answerPATCH(patchReq({ editedText: 'Corrected: I wrote the GitHub OAuth callback and the token exchange.' }), {
    params: Promise.resolve({ id: answerId }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string; editedAt: string };
  expect(body.id).toBe(answerId);
  expect(body.editedAt).toBeTruthy();

  const [row] = await tdb.admin`select edited_text, edited_at from answer where id = ${answerId}`;
  expect(row!.edited_text).toContain('token exchange');
  expect(row!.edited_at).not.toBeNull();
});

it('T022: PATCH by a non-owner → 404 and the edit is NOT applied (ownership gate)', async () => {
  const [answerRow] = await tdb.admin`select a.id from answer a join question q on q.id = a.question_id where q.user_id = ${UA} limit 1`;
  const answerId = answerRow!.id as string;

  // UB is in the same tenant but does not own UA's answer.
  h.session = { userId: UB, workspaceId: A };
  const res = await answerPATCH(patchReq({ editedText: 'MALICIOUS overwrite by another user' }), {
    params: Promise.resolve({ id: answerId }),
  });
  expect(res.status).toBe(404);

  const [row] = await tdb.admin`select edited_text from answer where id = ${answerId}`;
  expect(row!.edited_text).not.toContain('MALICIOUS'); // owner's edit survives
});

it('T022: honest guards — missing topic → 400, no session → 401', async () => {
  h.session = { userId: UA, workspaceId: A };
  expect((await summaryPOST(summaryReq({}))).status).toBe(400);

  h.session = null;
  expect((await summaryPOST(summaryReq({ topic: 'authentication' }))).status).toBe(401);
});
