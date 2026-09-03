// Feature 005 (In-Meeting Decision Listener) — retention helpers (D6). getWorkspaceRetentionDays reads
// the workspace's retention window (0 = off); setWorkingCopyExpiry extends the working-copy TTL without
// touching the persisted utterances. Docker required.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, type DbHandle } from '@falcon/db';
import {
  getWorkspaceRetentionDays, setWorkingCopyExpiry, createMeeting, persistWorkingCopy, readWorkingCopy,
  reapExpiredWorkingCopies, getMeeting, setTranscriptRetainedUntil,
  type MeetingDeps,
} from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const WS_A = '00000000-0000-0000-0000-0000000000aa';

let tdb: TestDb;
let db: DbHandle;
let deps: MeetingDeps;

beforeAll(async () => {
  tdb = await startTestDb();
  db = createDb(tdb.appUrl);
  deps = { db };
  await tdb.admin`insert into workspace ${tdb.admin({ id: WS_A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('getWorkspaceRetentionDays reads the workspace setting (default 0)', async () => {
  expect(await getWorkspaceRetentionDays(deps, WS_A)).toBe(0);
  await tdb.admin`update workspace set meeting_retention_days = 7 where id = ${WS_A}`;
  expect(await getWorkspaceRetentionDays(deps, WS_A)).toBe(7);
});

it('setWorkingCopyExpiry extends the working-copy TTL without touching utterances', async () => {
  const { meetingId } = await createMeeting(deps, WS_A, { sessionId: randomUUID(), attendees: [] });
  await persistWorkingCopy(deps, WS_A, meetingId, [{ idx: 0, speaker: 'a', userId: 'u', text: 'hi', tsMs: 1 }], new Date(Date.now() + 3600_000));
  const later = new Date(Date.now() + 14 * 86400_000);
  await setWorkingCopyExpiry(deps, WS_A, meetingId, later);
  const wc = await readWorkingCopy(deps, WS_A, meetingId);
  expect(wc!.utterances).toHaveLength(1); // utterances intact
});

it('reapExpiredWorkingCopies deletes past-TTL transcripts (the consent promise) and leaves live ones', async () => {
  // expired: TTL already passed (a deferred/failed extraction that never hit the delete)
  const expired = await createMeeting(deps, WS_A, { sessionId: randomUUID(), attendees: [] });
  await persistWorkingCopy(deps, WS_A, expired.meetingId, [{ idx: 0, speaker: 'a', userId: 'u', text: 'secret', tsMs: 1 }], new Date(Date.now() - 60_000));
  await setTranscriptRetainedUntil(deps, WS_A, expired.meetingId, new Date(Date.now() + 86400_000));
  // live: TTL still in the future
  const live = await createMeeting(deps, WS_A, { sessionId: randomUUID(), attendees: [] });
  await persistWorkingCopy(deps, WS_A, live.meetingId, [{ idx: 0, speaker: 'a', userId: 'u', text: 'keep', tsMs: 1 }], new Date(Date.now() + 3600_000));

  const reaped = await reapExpiredWorkingCopies(deps);
  expect(reaped).toBeGreaterThanOrEqual(1);
  expect(await readWorkingCopy(deps, WS_A, expired.meetingId)).toBeNull();       // gone
  expect((await getMeeting(deps, WS_A, expired.meetingId))!.transcriptRetainedUntil).toBeNull(); // marked discarded (D6)
  expect((await readWorkingCopy(deps, WS_A, live.meetingId))!.utterances).toHaveLength(1);        // survives
});
