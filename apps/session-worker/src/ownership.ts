import type { Redis } from 'ioredis';

/**
 * Per-session ownership: a Redis lease (key + TTL, heartbeat-renewed) plus a **monotonic fencing
 * token** incremented on every successful fresh claim (§12.5, R14). The lease holder is the only
 * worker allowed to write/publish for the session. Every panel push carries the token; clients
 * reject any message whose token is lower than the highest they've seen — so a zombie worker that
 * returns after a partition (while a replacement is live) can never publish. Split-brain is
 * impossible by construction, not by best effort.
 *
 * Recovery is a **symmetric reconciler**, not a central supervisor (§6.3): every worker compares the
 * sessions it should own (hash ring × live membership) against the leases it holds and claims the
 * delta — so a dead worker's sessions are picked up by an already-running worker, not respawned.
 */

// Acquire the lease if free/expired → issue a NEW (higher) fencing token; if we already hold it →
// return the current token unchanged; if another owner holds it → -1.
const CLAIM = `
if redis.call('set', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
  return redis.call('incr', KEYS[2])
elseif redis.call('get', KEYS[1]) == ARGV[1] then
  return tonumber(redis.call('get', KEYS[2])) or 0
else
  return -1
end`;

// Extend the TTL iff we still hold the lease.
const RENEW = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  redis.call('pexpire', KEYS[1], ARGV[2])
  return 1
else
  return 0
end`;

// Release iff we hold it.
const RELEASE = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end`;

export interface Ownership {
  /** Acquire/confirm the lease. Returns a fencing token (strictly higher on a fresh claim; the
   *  unchanged current token when we already own it), or null when another live owner holds it. */
  claim(): Promise<number | null>;
  /** Extend the lease TTL iff we still hold it; false means we lost it (someone else claimed). */
  renew(): Promise<boolean>;
  /** Release the lease iff we hold it. */
  release(): Promise<void>;
  /** Highest fencing token issued for this session so far. */
  currentToken(): Promise<number>;
  /** True iff this owner currently holds the lease. */
  isOwner(): Promise<boolean>;
}

export function createOwnership(redis: Redis, sessionId: string, ownerId: string, ttlMs = 3000): Ownership {
  const leaseKey = `session:${sessionId}:lease`;
  const fenceKey = `session:${sessionId}:fence`;

  return {
    async claim() {
      const token = (await redis.eval(CLAIM, 2, leaseKey, fenceKey, ownerId, String(ttlMs))) as number;
      return token === -1 ? null : token;
    },
    async renew() {
      const ok = (await redis.eval(RENEW, 1, leaseKey, ownerId, String(ttlMs))) as number;
      return ok === 1;
    },
    async release() {
      await redis.eval(RELEASE, 1, leaseKey, ownerId);
    },
    async currentToken() {
      const raw = await redis.get(fenceKey);
      return raw ? Number(raw) : 0;
    },
    async isOwner() {
      return (await redis.get(leaseKey)) === ownerId;
    },
  };
}

/** A client's split-brain guard: accept a message only if its fencing token is ≥ the highest seen. */
export function isFresh(token: number, highestSeen: number): boolean {
  return token >= highestSeen;
}

/**
 * Symmetric reconciler (pure): given the sessions this worker SHOULD own and the leases it currently
 * holds, return the delta to claim. No central supervisor — each worker claims what it now maps to.
 */
export function reconcileDelta(shouldOwn: readonly string[], held: readonly string[]): string[] {
  const heldSet = new Set(held);
  return shouldOwn.filter((s) => !heldSet.has(s));
}

/** Consistent-hash a session_id onto one worker from the live set — deterministic across all workers
 *  given the same membership, so ownership needs no coordination (§6.3). */
export function ownerFor(sessionId: string, workers: readonly string[]): string | null {
  if (workers.length === 0) return null;
  let h = 2166136261;
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return workers[h % workers.length] ?? null;
}
