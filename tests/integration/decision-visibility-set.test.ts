import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import { createDecision, confirmDecision, setVisibility, getDecision, type CoreDeps } from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const M2 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');

const WS_A = '00000000-0000-0000-0000-0000000000aa';
const REVIEWER = '00000000-0000-0000-0000-0000000000a1';
const attendees = [{ userId: REVIEWER, displayName: 'Guru', isMember: true, isFalconUser: true }];

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
  await tdb.admin`insert into "user" ${tdb.admin({ id: REVIEWER, email: 'reviewer@x.com' }, 'id', 'email')}`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

async function seedUnconfirmed(title: string) {
  const { id } = await createDecision(deps, WS_A, { title, decision: `${title} d`, origin: 'meeting', sourceRef: `meeting:${title}`, participants: attendees });
  return id; // created visibility='workspace' by default, unconfirmed
}

it('confirm-time visibility choice sets attendees_only', async () => {
  const id = await seedUnconfirmed('Scoped');
  const res = await confirmDecision(deps, WS_A, id, REVIEWER, undefined, 'attendees_only');
  expect(res.status).toBe('confirmed');
  // the reviewer is an attendee, so they can read it back
  expect((await getDecision(deps, WS_A, id, REVIEWER))!.status).toBe('confirmed');
});

it('setVisibility widens attendees_only -> workspace (one-way), then is a no-op', async () => {
  const id = await seedUnconfirmed('Widen');
  await confirmDecision(deps, WS_A, id, REVIEWER, undefined, 'attendees_only');
  expect((await setVisibility(deps, WS_A, id)).status).toBe('widened');
  // now workspace-visible: even a non-attendee (no viewer) can getDecision it
  expect((await getDecision(deps, WS_A, id))!.id).toBe(id);
  expect((await setVisibility(deps, WS_A, id)).status).toBe('already_workspace'); // idempotent, never narrows
});

it('setVisibility on a workspace record is already_workspace (cannot narrow)', async () => {
  const id = await seedUnconfirmed('Public');
  await confirmDecision(deps, WS_A, id, REVIEWER); // defaults to workspace
  expect((await setVisibility(deps, WS_A, id)).status).toBe('already_workspace');
});

it('setVisibility on a missing id returns not_found', async () => {
  expect((await setVisibility(deps, WS_A, randomUUID())).status).toBe('not_found');
});
