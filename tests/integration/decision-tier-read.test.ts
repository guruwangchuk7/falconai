// Task D2 — read-side tier enforcement. getDecisionSpans (viewer-gated, DB-enforced by D1/0008) +
// tier-gated searchDecisions/getDecision (D13 visibility: workspace | attendees_only). Uses a FAKE
// embed (all-zero vectors) so vector search is deterministic — the tier filter, not similarity,
// decides membership. Docker required.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import { createDecision, confirmDecision, searchDecisions, getDecision, getDecisionSpans, type CoreDeps } from '@falcon/core';
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

async function seedConfirmed(visibility: 'workspace' | 'attendees_only', title: string) {
  const { id } = await createDecision(deps, WS_A, {
    title, decision: `${title} decided`, origin: 'meeting', sourceRef: `meeting:${title}`,
    visibility, participants: attendees,
    spans: [{ kind: 'decision', utteranceIdx: 1, speaker: 'Guru', tsMs: 100, text: `${title} verbatim` }],
  });
  await confirmDecision(deps, WS_A, id, ATTENDEE); // unconfirmed -> confirmed
  return id;
}

it('getDecisionSpans: attendee sees spans, non-attendee sees none (DB-gated)', async () => {
  const id = await seedConfirmed('workspace', 'Postgres');
  expect(await getDecisionSpans(deps, WS_A, id, ATTENDEE)).toHaveLength(1);
  expect(await getDecisionSpans(deps, WS_A, id, OUTSIDER)).toHaveLength(0);
});

it('searchDecisions: a workspace-tier decision is visible to anyone', async () => {
  const id = await seedConfirmed('workspace', 'Tailwind');
  const asOutsider = await searchDecisions(deps, WS_A, 'anything', 20, undefined, undefined, OUTSIDER);
  expect(asOutsider.some((d) => d.id === id)).toBe(true);
});

it('searchDecisions: an attendees_only decision grounds ONLY for an attendee', async () => {
  const id = await seedConfirmed('attendees_only', 'SecretPivot');
  const asAttendee = await searchDecisions(deps, WS_A, 'anything', 20, undefined, undefined, ATTENDEE);
  const asOutsider = await searchDecisions(deps, WS_A, 'anything', 20, undefined, undefined, OUTSIDER);
  const asNoViewer = await searchDecisions(deps, WS_A, 'anything', 20); // no viewer -> excluded
  expect(asAttendee.some((d) => d.id === id)).toBe(true);
  expect(asOutsider.some((d) => d.id === id)).toBe(false);
  expect(asNoViewer.some((d) => d.id === id)).toBe(false);
});

it('getDecision: attendees_only hidden from non-attendee, visible to attendee', async () => {
  const id = await seedConfirmed('attendees_only', 'PrivateCall');
  expect(await getDecision(deps, WS_A, id, OUTSIDER)).toBeNull();
  expect((await getDecision(deps, WS_A, id, ATTENDEE))!.id).toBe(id);
});
