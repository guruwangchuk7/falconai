// Task D3 — D15 cross-tier supersede status-only projection. When a supersede chain crosses a tier
// boundary (a workspace record linked to an attendees_only neighbor a viewer can't see), getDecision
// must project the FACT of the link ("superseded by / supersedes a decision you don't have access to")
// without leaking the inaccessible neighbor's title. Docker required.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import { createDecision, confirmDecision, supersedeDecision, getDecision, type CoreDeps } from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const M2 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');

const WS_A = '00000000-0000-0000-0000-0000000000aa';

const ATTENDEE = '00000000-0000-0000-0000-0000000000a1';
const OUTSIDER = '00000000-0000-0000-0000-0000000000b2';
const attendees = [{ userId: ATTENDEE, displayName: 'Guru', isMember: true, isFalconUser: true }];

let tdb: TestDb;
let db: DbHandle;

const llm: LlmProviders = {
  chat: { model: 'test-model', complete: async () => ({ text: '{"claims":[]}', usage: { inputTokens: 0, outputTokens: 0 } }) },
  embeddings: {
    model: EMBEDDING_MODEL,
    version: EMBEDDING_VERSION,
    dim: 1024,
    embed: async (xs: string[]) => xs.map(() => new Array(1024).fill(0)),
  },
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

async function mk(visibility: 'workspace' | 'attendees_only', title: string) {
  const { id } = await createDecision(deps, WS_A, { title, decision: `${title} d`, origin: 'meeting', sourceRef: `meeting:${title}`, visibility, participants: attendees });
  await confirmDecision(deps, WS_A, id, ATTENDEE);
  return id;
}

it('workspace record superseded by an attendees_only record: non-attendee sees RESTRICTED, not the title', async () => {
  const oldId = await mk('workspace', 'Postgres');        // visible to all
  const newId = await mk('attendees_only', 'SQLitePrivate'); // private successor
  await supersedeDecision(deps, WS_A, { newRecordId: newId, supersedesId: oldId });

  const asOutsider = await getDecision(deps, WS_A, oldId, OUTSIDER);
  expect(asOutsider).not.toBeNull();                       // the workspace record itself is still visible
  expect(asOutsider!.supersededByTitle).toBeNull();        // successor title HIDDEN
  expect(asOutsider!.supersededById).toBeNull();           // no link to an inaccessible detail
  expect(asOutsider!.supersededByRestricted).toBe(true);   // "superseded by a decision you don't have access to"

  const asAttendee = await getDecision(deps, WS_A, oldId, ATTENDEE);
  expect(asAttendee!.supersededByTitle).toBe('SQLitePrivate'); // attendee sees it
  expect(asAttendee!.supersededByRestricted).toBe(false);
});

it('reverse direction: a new record supersedes an attendees_only record; a non-attendee viewing the new one sees supersedesRestricted', async () => {
  const oldId = await mk('attendees_only', 'PrivateOld');
  const newId = await mk('workspace', 'PublicNew');
  await supersedeDecision(deps, WS_A, { newRecordId: newId, supersedesId: oldId });

  const asOutsider = await getDecision(deps, WS_A, newId, OUTSIDER);
  expect(asOutsider!.supersedesTitle).toBeNull();
  expect(asOutsider!.supersedesRestricted).toBe(true);
});

it('all-workspace chain is unrestricted for everyone', async () => {
  const oldId = await mk('workspace', 'A1');
  const newId = await mk('workspace', 'A2');
  await supersedeDecision(deps, WS_A, { newRecordId: newId, supersedesId: oldId });
  const d = await getDecision(deps, WS_A, oldId, OUTSIDER);
  expect(d!.supersededByTitle).toBe('A2');
  expect(d!.supersededByRestricted).toBe(false);
});
