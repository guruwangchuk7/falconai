// Feature 005 US2 — the four-state boundary against real Postgres. A confirmed decision grounds and
// cites; an UNCONFIRMED candidate surfaces as status metadata only (existence + source pointer), never
// as content or a citation. Asserts co-occurrence (settled + pendingChange), zero unconfirmed-content
// leakage, and exactly ONE query embed per question (R7). LLM claims canned; retrieval/RLS real.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import { answerQuestion, matchUnconfirmedCandidates, type CoreDeps } from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const M2 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');

const A = '00000000-0000-0000-0000-0000000000aa';
const UA = '00000000-0000-0000-0000-0000000000a1';
const VEC = `[${Array(1024).fill(0.1).join(',')}]`;

// Unconfirmed content that MUST NEVER appear in an answer payload.
const SECRET_UNCONFIRMED = ['Switch STT to AssemblyAI', 'Move to AssemblyAI', 'better diarization'] as const;

let tdb: TestDb;
let db: DbHandle;
let cannedAnswer = '{"claims":[]}';
let embedCalls = 0;

const llm: LlmProviders = {
  chat: { model: 'test-model', complete: async () => ({ text: cannedAnswer, usage: { inputTokens: 0, outputTokens: 0 } }) },
  embeddings: {
    model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, dim: 1024,
    embed: async (texts: string[]) => { embedCalls += 1; return texts.map(() => Array(1024).fill(0.1)); },
  },
  rerank: { model: 'r', rerank: async () => [] },
} as unknown as LlmProviders;

let deps: CoreDeps;

beforeAll(async () => {
  tdb = await startTestDb();
  await tdb.admin.unsafe(readFileSync(M2, 'utf8'));
  db = createDb(tdb.appUrl);
  deps = { db, llm };
  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'a@x.com' }, 'id', 'email')}`;
  // One CONFIRMED decision (grounding evidence) …
  await tdb.admin`insert into decision_record (workspace_id, title, decision, status, embedding, embedding_model, embedding_version)
    values (${A}, 'STT provider: Deepgram', 'Use Deepgram Nova', 'confirmed', ${VEC}::vector, ${EMBEDDING_MODEL}, ${EMBEDDING_VERSION})`;
  // … and one UNCONFIRMED candidate proposing a change (must stay metadata-only).
  await tdb.admin`insert into decision_record (workspace_id, title, decision, rationale, source_ref, status, embedding, embedding_model, embedding_version)
    values (${A}, ${SECRET_UNCONFIRMED[0]}, ${SECRET_UNCONFIRMED[1]}, ${SECRET_UNCONFIRMED[2]}, '#41', 'unconfirmed', ${VEC}::vector, ${EMBEDDING_MODEL}, ${EMBEDDING_VERSION})`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

function assertNoLeak(answer: unknown) {
  const blob = JSON.stringify(answer);
  for (const s of SECRET_UNCONFIRMED) expect(blob).not.toContain(s);
}

it('settled + pendingChange CO-OCCUR; unconfirmed content never leaks (FR-008/FR-009)', async () => {
  cannedAnswer = '{"claims":[{"text":"We use Deepgram Nova.","citations":[1]}]}';
  const a = await answerQuestion(deps, { workspaceId: A, requesterUserId: UA, question: 'what STT provider do we use?' });
  expect(a.status).toBe('grounded');
  expect(a.decisionStatus?.settled).toBeTruthy();           // the confirmed decision grounded it
  expect(a.decisionStatus?.pendingChange?.count).toBeGreaterThanOrEqual(1); // the unconfirmed candidate rides alongside
  expect(a.decisionStatus?.pendingChange?.sourceRefs).toContain('#41');     // metadata pointer only
  assertNoLeak(a); // no 'AssemblyAI' / rationale text anywhere in the payload
});

it('proposed → an unconfirmed candidate is surfaced even when nothing confirmed grounds (FR-009)', async () => {
  cannedAnswer = '{"claims":[]}'; // model finds nothing citable
  const a = await answerQuestion(deps, { workspaceId: A, requesterUserId: UA, question: 'are we switching transcription vendors?' });
  expect(a.status).toBe('no_grounded_answer'); // still grounded-or-silent on the answer itself
  expect(a.decisionStatus?.proposed?.count).toBeGreaterThanOrEqual(1);
  expect(a.decisionStatus?.proposed?.sourceRefs).toContain('#41');
  expect(a.decisionStatus?.settled).toBeUndefined();
  assertNoLeak(a);
});

it('embeds the query exactly ONCE per question (R7 — shared across retrieve/search/match)', async () => {
  cannedAnswer = '{"claims":[{"text":"We use Deepgram Nova.","citations":[1]}]}';
  embedCalls = 0;
  await answerQuestion(deps, { workspaceId: A, requesterUserId: UA, question: 'what STT provider do we use?' });
  expect(embedCalls).toBe(1);
});

it('matchUnconfirmedCandidates returns METADATA ONLY — no decision/rationale/title (FR-008)', async () => {
  const matches = await matchUnconfirmedCandidates(deps, A, 'transcription vendor', 4);
  expect(matches.length).toBeGreaterThanOrEqual(1);
  for (const m of matches) {
    expect(Object.keys(m).sort()).toEqual(['createdAt', 'distance', 'id', 'sourceRef']);
  }
});
