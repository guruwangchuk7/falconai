// C1 (transcript-paste capture) — ingestPastedTranscript wiring against real Postgres with RLS.
// A pasted transcript with NO paired session must still produce a meeting (synthetic session id) +
// a text-only working copy of the parsed utterances, ready for the shipped extract job. Docker required.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import { ingestPastedTranscript, readWorkingCopy, getMeeting, type CoreDeps } from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const WS = '00000000-0000-0000-0000-0000000000c1';
const USER = '00000000-0000-0000-0000-0000000000c2';

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
  await tdb.admin`insert into workspace ${tdb.admin({ id: WS, name: 'C', settings: {} }, 'id', 'name', 'settings')}`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('creates a meeting (sole attendee = paster) + a working copy of the parsed utterances', async () => {
  const res = await ingestPastedTranscript(deps, WS, {
    userId: USER,
    displayName: 'Guru',
    title: 'Acme weekly',
    text: 'Guru: Keep the original checkout flow.\nSarah: Agreed — remove guest checkout.',
  });
  expect(res).not.toBeNull();
  expect(res!.utteranceCount).toBe(2);

  const meeting = await getMeeting(deps, WS, res!.meetingId);
  expect(meeting).not.toBeNull();
  expect(meeting!.title).toBe('Acme weekly');
  expect(meeting!.attendees).toHaveLength(1);
  expect(meeting!.attendees[0]!.userId).toBe(USER); // raw spans stay gated to the paster
  expect(meeting!.designatedReviewerUserId).toBe(USER);

  const wc = await readWorkingCopy(deps, WS, res!.meetingId);
  expect(wc!.utterances).toHaveLength(2);
  expect(wc!.utterances[0]).toMatchObject({ idx: 0, speaker: 'Guru', userId: null, text: 'Keep the original checkout flow.' });
  expect(wc!.utterances[1]!.speaker).toBe('Sarah');
});

it('returns null and writes nothing for an empty transcript', async () => {
  const res = await ingestPastedTranscript(deps, WS, { userId: USER, displayName: 'Guru', text: '   \n\n  ' });
  expect(res).toBeNull();
});
