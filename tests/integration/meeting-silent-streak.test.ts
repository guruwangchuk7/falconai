// Feature 005 — silent-zero alarm. A parser/model/prompt/API break is indistinguishable from a genuine
// "no decisions": all produce `no_decision` ledger rows. checkSilentExtractionStreak finds the signal that
// separates them — a RUN of consecutive `no_decision` that a real `suggested` would have reset. Docker.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, type DbHandle } from '@falcon/db';
import { checkSilentExtractionStreak, recordMinedMeeting, type CoreDeps } from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const WS = '00000000-0000-0000-0000-0000000000aa';
let tdb: TestDb;
let db: DbHandle;
let deps: CoreDeps;

beforeAll(async () => {
  tdb = await startTestDb();
  db = createDb(tdb.appUrl);
  deps = { db } as CoreDeps;
  await tdb.admin`insert into workspace ${tdb.admin({ id: WS, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

const record = (result: 'suggested' | 'no_decision') =>
  recordMinedMeeting(deps, WS, randomUUID(), { result, extractorVersion: 'v1' });

it('fires when the last N extractions are ALL no_decision, and a real decision resets the run', async () => {
  await record('no_decision');
  await record('no_decision');
  expect(await checkSilentExtractionStreak(deps, 3)).toEqual([]); // only 2 — below threshold

  await record('no_decision'); // now 3 in a row
  const alert = await checkSilentExtractionStreak(deps, 3);
  expect(alert).toHaveLength(1);
  expect(alert[0]!.workspaceId).toBe(WS);
  expect(alert[0]!.streak).toBe(3);

  await record('suggested'); // a real decision — resets the run
  expect(await checkSilentExtractionStreak(deps, 3)).toEqual([]); // newest window now contains a suggested
});

it('does not fire below the threshold, and threshold<=0 is a no-op', async () => {
  expect(await checkSilentExtractionStreak(deps, 100)).toEqual([]); // far more than exist
  expect(await checkSilentExtractionStreak(deps, 0)).toEqual([]);
});
