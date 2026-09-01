// Phase 2 (spec 002-personal-falcon, T012/T013/T019/T021) — the grounded-answer path against real
// Postgres. The LLM is mocked (deterministic claims); retrieval, ACL, RLS, and the decision
// confirmed-only filter are REAL. Docker required.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import { answerQuestion, searchDecisions, type CoreDeps } from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const M2 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');
const M4 = resolve(HERE, '../../packages/db/drizzle/0004_decision_dismissed_at.sql');

const A = '00000000-0000-0000-0000-0000000000aa';
const UA = '00000000-0000-0000-0000-0000000000a1';
const UB = '00000000-0000-0000-0000-0000000000b1';
const ART = '00000000-0000-0000-0000-0000000000f1';
const VEC = `[${Array(1024).fill(0.1).join(',')}]`;

let tdb: TestDb;
let db: DbHandle;
let cannedAnswer = '{"claims":[]}';

const llm: LlmProviders = {
  chat: { model: 'test-model', complete: async () => ({ text: cannedAnswer, usage: { inputTokens: 0, outputTokens: 0 } }) },
  embeddings: { model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, dim: 1024, embed: async () => [Array(1024).fill(0.1)] },
  rerank: { model: 'r', rerank: async () => [] },
} as unknown as LlmProviders;

let deps: CoreDeps;

beforeAll(async () => {
  tdb = await startTestDb();
  await tdb.admin.unsafe(readFileSync(M2, 'utf8'));
  await tdb.admin.unsafe(readFileSync(M4, 'utf8')); // answerQuestion now queries decision_record.dismissed_at
  db = createDb(tdb.appUrl);
  deps = { db, llm };

  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'a@x.com' }, 'id', 'email')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UB, email: 'b@x.com' }, 'id', 'email')}`;

  // UA owns one artifact in repo-a (gives UA access to repo-a; UB has no artifacts → no access).
  await tdb.admin`insert into artifact (id, workspace_id, user_id, source, external_ref, type, title, acl_tags, trust_tier, source_updated_at, last_synced_at)
    values (${ART}, ${A}, ${UA}, 'github', 'sha1', 'commit', 'auth commit', '["repo-a"]'::jsonb, 'trusted', now(), now())`;
  await tdb.admin`insert into artifact_chunk (workspace_id, artifact_id, chunk_index, content, trust_tier, embedding, embedding_model, embedding_version)
    values (${A}, ${ART}, 0, 'implemented the GitHub auth callback', 'trusted', ${VEC}::vector, ${EMBEDDING_MODEL}, ${EMBEDDING_VERSION})`;

  // One confirmed + one superseded decision (both embedded).
  await tdb.admin`insert into decision_record (workspace_id, title, decision, status, embedding, embedding_model, embedding_version)
    values (${A}, 'Use Postgres RLS for tenant isolation', 'RLS chosen', 'confirmed', ${VEC}::vector, ${EMBEDDING_MODEL}, ${EMBEDDING_VERSION})`;
  await tdb.admin`insert into decision_record (workspace_id, title, decision, status, embedding, embedding_model, embedding_version)
    values (${A}, 'Superseded: use app-layer checks', 'old', 'superseded', ${VEC}::vector, ${EMBEDDING_MODEL}, ${EMBEDDING_VERSION})`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('T012: a grounded answer cites only retrieved artifacts, ≥1 citation per claim', async () => {
  cannedAnswer = '{"claims":[{"text":"You implemented the GitHub auth callback.","citations":[1]}]}';
  const a = await answerQuestion(deps, { workspaceId: A, requesterUserId: UA, question: 'what did I do for auth?' });
  expect(a.status).toBe('grounded');
  expect(a.claims.length).toBeGreaterThan(0);
  for (const c of a.claims) expect(c.citations.length).toBeGreaterThan(0);
  expect(a.claims[0]!.citations[0]!.artifactId).toBe(ART); // candidate 1 = the retrieved artifact
});

it('T013: unsupported claim (citation out of range) is dropped → no_grounded_answer', async () => {
  cannedAnswer = '{"claims":[{"text":"You built a billing system.","citations":[99]}]}';
  const a = await answerQuestion(deps, { workspaceId: A, requesterUserId: UA, question: 'billing?' });
  expect(a.status).toBe('no_grounded_answer');
  expect(a.generatedText).toBeNull();
});

it('T019: ACL — a user cannot cite another user\'s inaccessible artifact', async () => {
  cannedAnswer = '{"claims":[{"text":"x","citations":[1,2,3,4]}]}';
  const a = await answerQuestion(deps, { workspaceId: A, requesterUserId: UB, question: 'what did UA do for auth?' });
  const citedArtifacts = a.claims.flatMap((c) => c.citations.map((x) => x.artifactId));
  expect(citedArtifacts).not.toContain(ART); // UB has no access to UA's repo-a artifact
});

it('T021: only CONFIRMED decisions are retrievable', async () => {
  const decisions = await searchDecisions(deps, A, 'tenant isolation decision', 10);
  expect(decisions.length).toBe(1);
  expect(decisions[0]!.title).toContain('Use Postgres RLS');
});
