// Phase 3 (spec 004-pairing, T013) — per-session ownership (§12.5, R14): a lease + monotonic fencing
// token makes split-brain impossible, and a dead worker's session is picked up by another (symmetric
// reconciler, no supervisor). Runs against a real Redis (Testcontainers).
import { it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { createOwnership, isFresh, reconcileDelta, ownerFor } from '../../apps/session-worker/src/ownership.js';
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

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

it('a fresh claim issues a token; re-claim by the same owner is stable; a rival is refused', async () => {
  const a = createOwnership(redis, 'own-1', 'worker-A', 3000);
  const t1 = await a.claim();
  expect(t1).not.toBeNull();
  expect(await a.claim()).toBe(t1); // same owner re-claim → unchanged token
  const b = createOwnership(redis, 'own-1', 'worker-B', 3000);
  expect(await b.claim()).toBeNull(); // contended — A still holds the lease
});

it('after the lease expires another worker claims a HIGHER token; the stale token is rejected', async () => {
  const a = createOwnership(redis, 'own-2', 'worker-A', 300);
  const t1 = await a.claim();
  await delay(450); // A "dies" — stops renewing, lease expires
  const b = createOwnership(redis, 'own-2', 'worker-B', 300);
  const t2 = await b.claim();
  expect(t2).not.toBeNull();
  expect(t2!).toBeGreaterThan(t1!);
  expect(await b.isOwner()).toBe(true);
  expect(isFresh(t1!, t2!)).toBe(false); // a zombie publish with the old token is rejected
  expect(isFresh(t2!, t2!)).toBe(true);
});

it('renew keeps ownership; a non-owner cannot renew', async () => {
  const a = createOwnership(redis, 'own-3', 'worker-A', 500);
  await a.claim();
  expect(await a.renew()).toBe(true);
  const b = createOwnership(redis, 'own-3', 'worker-B', 500);
  expect(await b.renew()).toBe(false);
});

it('the reconciler is deterministic and returns the unheld delta', () => {
  const workers = ['w1', 'w2', 'w3'];
  const owner = ownerFor('session-xyz', workers);
  expect(owner).toBe(ownerFor('session-xyz', workers)); // deterministic across workers
  expect(workers).toContain(owner);
  expect(reconcileDelta(['s1', 's2', 's3'], ['s2'])).toEqual(['s1', 's3']);
});
