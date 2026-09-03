// Feature 005 (In-Meeting Decision Listener), Task B2 — core meeting + working-copy persistence
// against real Postgres with RLS. The meeting object carries an immutable attendee snapshot (D12);
// the working-copy transcript is TEXT ONLY, never audio (R6), and is idempotently upsertable.
// Tenant isolation (RLS) is asserted with a second workspace. Docker required.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import {
  createMeeting, persistWorkingCopy, readWorkingCopy, deleteWorkingCopy,
  setTranscriptRetainedUntil, getMeeting,
  type Utterance, type Attendee, type CoreDeps,
} from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const WS_A = '00000000-0000-0000-0000-0000000000aa';
const WS_B = '00000000-0000-0000-0000-0000000000bb';

let tdb: TestDb;
let db: DbHandle;

const llm: LlmProviders = {
  chat: { model: 'test-model', complete: async () => ({ text: '{"claims":[]}', usage: { inputTokens: 0, outputTokens: 0 } }) },
  embeddings: { model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, dim: 1024, embed: async (texts: string[]) => texts.map(() => Array(1024).fill(0.1)) },
  rerank: { model: 'r', rerank: async () => [] },
} as unknown as LlmProviders;

let deps: CoreDeps;

const ATTENDEES: Attendee[] = [
  { userId: '00000000-0000-0000-0000-0000000000a1', displayName: 'Guru', isMember: true, isFalconUser: true },
  { userId: '00000000-0000-0000-0000-0000000000a2', displayName: 'Sarah', isMember: true, isFalconUser: true },
];
const UTTS: Utterance[] = [
  { idx: 0, speaker: 'Guru', userId: '00000000-0000-0000-0000-0000000000a1', text: 'the concurrency thing kills sqlite', tsMs: 1000 },
  { idx: 1, speaker: 'Sarah', userId: '00000000-0000-0000-0000-0000000000a2', text: 'okay, postgres then', tsMs: 240000 },
];

beforeAll(async () => {
  tdb = await startTestDb();
  db = createDb(tdb.appUrl);
  deps = { db, llm };
  await tdb.admin`insert into workspace ${tdb.admin({ id: WS_A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into workspace ${tdb.admin({ id: WS_B, name: 'B', settings: {} }, 'id', 'name', 'settings')}`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('createMeeting persists the attendee snapshot and returns an id', async () => {
  const { meetingId } = await createMeeting(deps, WS_A, {
    sessionId: randomUUID(), title: 'Standup', attendees: ATTENDEES,
    designatedReviewerUserId: ATTENDEES[0]!.userId,
  });
  const m = await getMeeting(deps, WS_A, meetingId);
  expect(m).not.toBeNull();
  expect(m!.attendees).toHaveLength(2);
  expect(m!.designatedReviewerUserId).toBe(ATTENDEES[0]!.userId);
  expect(m!.transcriptRetainedUntil).toBeNull();
});

it('working copy round-trips and is idempotent on re-persist', async () => {
  const { meetingId } = await createMeeting(deps, WS_A, { sessionId: randomUUID(), attendees: ATTENDEES });
  const expires = new Date(Date.now() + 48 * 3600_000);
  await persistWorkingCopy(deps, WS_A, meetingId, UTTS, expires);
  await persistWorkingCopy(deps, WS_A, meetingId, UTTS, expires); // upsert, no duplicate-key error
  const wc = await readWorkingCopy(deps, WS_A, meetingId);
  expect(wc!.utterances).toHaveLength(2);
  expect(wc!.utterances[1]!.text).toContain('postgres');
});

it('deleteWorkingCopy removes it; retention marker can be set', async () => {
  const { meetingId } = await createMeeting(deps, WS_A, { sessionId: randomUUID(), attendees: ATTENDEES });
  await persistWorkingCopy(deps, WS_A, meetingId, UTTS, new Date());
  const until = new Date(Date.now() + 7 * 86400_000);
  await setTranscriptRetainedUntil(deps, WS_A, meetingId, until);
  await deleteWorkingCopy(deps, WS_A, meetingId);
  expect(await readWorkingCopy(deps, WS_A, meetingId)).toBeNull();
  expect((await getMeeting(deps, WS_A, meetingId))!.transcriptRetainedUntil).not.toBeNull();
});

it('is tenant-isolated: WS_B cannot read a WS_A meeting or working copy', async () => {
  const { meetingId } = await createMeeting(deps, WS_A, { sessionId: randomUUID(), attendees: ATTENDEES });
  await persistWorkingCopy(deps, WS_A, meetingId, UTTS, new Date());
  expect(await getMeeting(deps, WS_B, meetingId)).toBeNull();
  expect(await readWorkingCopy(deps, WS_B, meetingId)).toBeNull();
});
