// Feature 005 review finding #2 — a decision citation must survive into conversation HISTORY. The
// history route reconstructs citations from answer_citation; a decision citation's artifact_id is a
// decision_record id (not an artifact), so the artifact join alone drops it. This test seeds an answer
// citing BOTH an artifact and a decision, then asserts GET /conversations/{id} returns the decision
// citation as a clickable /decisions/{id} link (matching the live answer). Route + Postgres real.
import { it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from '@falcon/db';
import type { CoreDeps } from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const h = vi.hoisted(() => ({ session: null as { userId: string; workspaceId: string } | null, deps: null as unknown as CoreDeps }));
vi.mock('@/lib/session', () => ({ getActiveSession: async () => h.session }));
vi.mock('@/lib/deps', () => ({ deps: () => h.deps, secrets: () => { throw new Error('unused'); } }));

import { GET as conversationGET } from '@/app/api/falcon/conversations/[id]/route';

const HERE = dirname(fileURLToPath(import.meta.url));
const M2 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');

const A = '00000000-0000-0000-0000-0000000000aa';
const UA = '00000000-0000-0000-0000-0000000000a1';
const ART = '00000000-0000-0000-0000-0000000000f1';
const DEC = '00000000-0000-0000-0000-0000000000d1';
const CONV = '00000000-0000-0000-0000-0000000000c1';
const Q = '00000000-0000-0000-0000-0000000000e1';
const ANS = '00000000-0000-0000-0000-0000000000b1';
const VEC = `[${Array(1024).fill(0.1).join(',')}]`;

let tdb: TestDb;
let db: DbHandle;

beforeAll(async () => {
  tdb = await startTestDb();
  await tdb.admin.unsafe(readFileSync(M2, 'utf8'));
  db = createDb(tdb.appUrl);
  h.deps = { db } as CoreDeps;

  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'a@x.com' }, 'id', 'email')}`;
  await tdb.admin`insert into artifact (id, workspace_id, user_id, source, external_ref, type, title, repo_or_project, acl_tags, trust_tier, source_updated_at, last_synced_at)
    values (${ART}, ${A}, ${UA}, 'github', '#7', 'pr', 'auth pr', 'octo/repo-a', '["repo-a"]'::jsonb, 'trusted', now(), now())`;
  await tdb.admin`insert into decision_record (id, workspace_id, title, decision, status, embedding, embedding_model, embedding_version)
    values (${DEC}, ${A}, 'Adopt Deepgram', 'Use Deepgram Nova', 'confirmed', ${VEC}::vector, 'voyage-code-4', 'voyage-code-4')`;
  await tdb.admin`insert into conversation (id, workspace_id, user_id, title) values (${CONV}, ${A}, ${UA}, 'why deepgram')`;
  await tdb.admin`insert into question (id, workspace_id, conversation_id, user_id, text, kind) values (${Q}, ${A}, ${CONV}, ${UA}, 'why did we choose deepgram?', 'qa')`;
  await tdb.admin`insert into answer (id, workspace_id, question_id, status, generated_text) values (${ANS}, ${A}, ${Q}, 'grounded', 'We chose Deepgram Nova.')`;
  // The answer cited BOTH the PR (artifact) and the decision (decision_record).
  await tdb.admin`insert into answer_citation (workspace_id, answer_id, artifact_id) values (${A}, ${ANS}, ${ART})`;
  await tdb.admin`insert into answer_citation (workspace_id, answer_id, artifact_id) values (${A}, ${ANS}, ${DEC})`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('finding #2: a cited decision survives into history as a clickable /decisions link', async () => {
  h.session = { userId: UA, workspaceId: A };
  const res = await conversationGET(new Request('http://test/api/falcon/conversations/x'), { params: Promise.resolve({ id: CONV }) });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { turns: Array<{ citations: Array<{ type: string; externalRef: string; url: string | null }> }> };

  const cits = body.turns[0]!.citations;
  const decision = cits.find((c) => c.type === 'decision');
  expect(decision).toBeTruthy();
  expect(decision!.url).toBe(`/decisions/${DEC}`);   // clickable, matching the live answer
  expect(decision!.externalRef).toBe('Adopt Deepgram');
  // The artifact citation is still present too (both kinds coexist).
  expect(cits.some((c) => c.type === 'pr' && c.url === 'https://github.com/octo/repo-a/pull/7')).toBe(true);
});
