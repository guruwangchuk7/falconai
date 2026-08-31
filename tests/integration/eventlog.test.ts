// Phase 3 (spec 004-pairing, T011) — the session event log's load-bearing CX-1 property: derived
// state is a fold over the log, and snapshots are a DISCARDABLE cache — deleting every snapshot must
// be a correctness no-op (only recovery latency grows). Runs against a real Redis (Testcontainers).
import { it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { createEventLog, type SessionEvent } from '../../apps/session-worker/src/eventlog.js';
import { startTestRedis, type TestRedis } from '../support/redis.js';

let tr: TestRedis;
let redis: Redis;

beforeAll(async () => {
  tr = await startTestRedis();
  redis = new Redis(tr.url, { maxRetriesPerRequest: null });
}, 120_000);

afterAll(async () => {
  redis.disconnect();
  await tr.stop();
});

// A deterministic fold: collect each event's seq and sum its payload `n`.
interface Fold {
  seqs: number[];
  sum: number;
}
const initial: Fold = { seqs: [], sum: 0 };
const reduce = (s: Fold, ev: SessionEvent): Fold => ({
  seqs: [...s.seqs, ev.seq],
  sum: s.sum + (ev.payload.n as number),
});

it('append assigns monotonic seqs and replay folds the whole log', async () => {
  const log = createEventLog(redis, 'sess-fold');
  for (let n = 1; n <= 5; n++) await log.append('tick', { n });

  const snap = await log.replay(initial, reduce);
  expect(snap.state.seqs).toEqual([1, 2, 3, 4, 5]);
  expect(snap.state.sum).toBe(15);
  expect(snap.lastSeq).toBe(5);
});

it('deleting the snapshot is a correctness no-op (CX-1)', async () => {
  const log = createEventLog(redis, 'sess-cx1');
  for (let n = 1; n <= 3; n++) await log.append('tick', { n });

  // Snapshot after 3 events, then append 3 more.
  await log.writeSnapshot(await log.replay(initial, reduce));
  for (let n = 4; n <= 6; n++) await log.append('tick', { n });

  const withSnapshot = await log.replay(initial, reduce); // snapshot + tail
  await log.deleteSnapshot();
  const withoutSnapshot = await log.replay(initial, reduce); // full-log replay

  expect(withoutSnapshot.state).toEqual(withSnapshot.state); // deleting the snapshot changed nothing
  expect(withoutSnapshot.state.seqs).toEqual([1, 2, 3, 4, 5, 6]);
  expect(withoutSnapshot.state.sum).toBe(21);
});
