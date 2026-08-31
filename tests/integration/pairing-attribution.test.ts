// Phase 3 (spec 004-pairing, T019) — exact attribution by construction (§6.1/G2): two clients speak
// (including over each other) and every utterance in the merged transcript stays attributed to the
// speaker whose connection produced it — zero cross-talk. Runs against a real Redis (Testcontainers).
import { it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { FakeSttProvider } from '@falcon/stt';
import { runIngest } from '../../apps/session-worker/src/server.js';
import { createEventLog, type SessionEvent } from '@falcon/session-core';
import { createOwnership } from '../../apps/session-worker/src/ownership.js';
import { mergedTranscript } from '@falcon/session-core';
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

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40));

it('two clients (incl. overlapping speech) keep exact per-speaker attribution — no cross-talk (SC-002)', async () => {
  const eventLog = createEventLog(redis, 'attr-1');
  const ownership = createOwnership(redis, 'attr-1', 'wA', 5000);
  await ownership.claim();

  const stt = new FakeSttProvider();
  const sA = stt.openStream({ userId: 'uA' });
  const sB = stt.openStream({ userId: 'uB' });
  const runA = runIngest(sA, 'uA', eventLog, ownership);
  const runB = runIngest(sB, 'uB', eventLog, ownership);

  const fA = stt.streams.get('uA')!;
  const fB = stt.streams.get('uB')!;
  fA.feedFinal(1, 'alpha');
  fB.feedFinal(1, 'beta'); // both speaking (overlap)
  fA.feedFinal(2, 'gamma');
  await tick();
  await sA.close();
  await sB.close();
  await Promise.all([runA, runB]);

  const { state: events } = await eventLog.replay<SessionEvent[]>([], (s, ev) => [...s, ev]);
  const { utterances } = mergedTranscript(events);

  const textsOf = (uid: string) => utterances.filter((m) => m.userId === uid).map((m) => m.text).sort();
  expect(textsOf('uA')).toEqual(['alpha', 'gamma']);
  expect(textsOf('uB')).toEqual(['beta']);
  expect(utterances).toHaveLength(3); // nothing dropped, nothing misattributed
});
