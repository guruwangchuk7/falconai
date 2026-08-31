// Phase 3 (spec 004-pairing, T014) — the session server's health app + the lease-guarded ingest
// path: utterance_final events are appended attributed to the connection OWNER (§6.1/G2), and ONLY
// while this worker holds the lease (a worker that lost it stops writing — split-brain guard, §12.5).
// Runs against a real Redis (Testcontainers).
import { it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { FakeSttProvider } from '@falcon/stt';
import { createSessionApp, runIngest, parseConnUrl } from '../../apps/session-worker/src/server.js';
import { createEventLog, type SessionEvent } from '@falcon/session-core';
import { createOwnership } from '../../apps/session-worker/src/ownership.js';
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

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

interface Utt {
  userId: string;
  text: string;
}
const collectUtts = (s: Utt[], ev: SessionEvent): Utt[] =>
  ev.type === 'utterance_final'
    ? [...s, { userId: ev.payload.userId as string, text: ev.payload.text as string }]
    : s;

it('createSessionApp serves /health', async () => {
  const app = createSessionApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ status: 'ok', service: 'falcon-session-worker' });
  await app.close();
});

it('parseConnUrl extracts sessionId + userId', () => {
  expect(parseConnUrl('/session/abc/connect?userId=u1')).toEqual({ sessionId: 'abc', userId: 'u1' });
  expect(parseConnUrl('/session/abc/connect')).toBeNull(); // no userId
  expect(parseConnUrl('/nope')).toBeNull();
});

it('the lease holder appends utterance_final attributed to the connection owner', async () => {
  const eventLog = createEventLog(redis, 'ing-1');
  const ownership = createOwnership(redis, 'ing-1', 'wA', 5000);
  expect(await ownership.claim()).not.toBeNull();

  const fake = new FakeSttProvider();
  const stream = fake.openStream({ userId: 'uA' });
  const done = runIngest(stream, 'uA', eventLog, ownership);

  const fs = fake.streams.get('uA')!;
  fs.feedFinal(1, 'hello');
  fs.feedFinal(2, 'world');
  await tick();
  await stream.close(); // end the ingest loop
  await done;

  const { state } = await eventLog.replay<Utt[]>([], collectUtts);
  expect(state).toEqual([
    { userId: 'uA', text: 'hello' },
    { userId: 'uA', text: 'world' },
  ]);
});

it('a worker that lost the lease stops writing (split-brain guard)', async () => {
  const eventLog = createEventLog(redis, 'ing-2');
  const ownership = createOwnership(redis, 'ing-2', 'wA', 5000);
  await ownership.claim();

  const fake = new FakeSttProvider();
  const stream = fake.openStream({ userId: 'uA' });
  const done = runIngest(stream, 'uA', eventLog, ownership);

  const fs = fake.streams.get('uA')!;
  fs.feedFinal(1, 'first'); // appended (still owner)
  await tick();
  await ownership.release(); // lose the lease
  fs.feedFinal(2, 'second'); // runIngest sees not-owner → returns without appending
  await tick();
  await stream.close();
  await done;

  const { state } = await eventLog.replay<Utt[]>([], collectUtts);
  expect(state).toEqual([{ userId: 'uA', text: 'first' }]);
});
