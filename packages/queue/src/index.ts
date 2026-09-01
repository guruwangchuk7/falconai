import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { loadEnv, redisEnv } from '@falcon/config';
import type { ArtifactInput } from '@falcon/integrations';

// Lazy getters so importing this package (e.g. in a Next.js route module) does NOT open a Redis
// connection at import/build time — only on first actual use.

export interface SyncJob { workspaceId: string; connectionId: string; delta?: ArtifactInput[] }
export interface IndexJob { workspaceId: string; artifactId: string }
export interface DigestJob { workspaceId: string; userId: string }
export interface MineJob { workspaceId: string; artifactId: string }

export const defaultJobOpts = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

let _conn: Redis | undefined;
export function conn(): Redis {
  if (!_conn) _conn = new Redis(loadEnv(redisEnv).REDIS_URL, { maxRetriesPerRequest: null });
  return _conn;
}

/** Fixed-window rate limiter on Redis (INCR + EXPIRE). Cheap and good enough to blunt floods on
 *  public endpoints (webhooks) and abusive connect attempts. `ok:false` → caller returns 429. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; remaining: number }> {
  const r = conn();
  const n = await r.incr(`rl:${key}`);
  if (n === 1) await r.expire(`rl:${key}`, windowSec);
  return { ok: n <= limit, remaining: Math.max(0, limit - n) };
}

let _sync: Queue<SyncJob> | undefined;
let _index: Queue<IndexJob> | undefined;
let _digest: Queue<DigestJob> | undefined;
let _maint: Queue | undefined;
let _mine: Queue<MineJob> | undefined;

export const syncQueue = (): Queue<SyncJob> => (_sync ??= new Queue<SyncJob>('sync', { connection: conn() }));
export const indexQueue = (): Queue<IndexJob> => (_index ??= new Queue<IndexJob>('index', { connection: conn() }));
export const digestQueue = (): Queue<DigestJob> => (_digest ??= new Queue<DigestJob>('digest', { connection: conn() }));
export const maintenanceQueue = (): Queue => (_maint ??= new Queue('maintenance', { connection: conn() }));
export const mineQueue = (): Queue<MineJob> => (_mine ??= new Queue<MineJob>('mine', { connection: conn() }));

/** Stable, content-addressed mine job id: dedups an artifact's mine job at a given extractor
 *  version + content hash. `dayBucket` is used by the budget-defer re-enqueue (Task 8) to dedup
 *  per-UTC-day instead of per-content-hash (the re-enqueue doesn't have the artifact body handy). */
export function mineJobId(workspaceId: string, artifactId: string, version: string, contentHash8: string, dayBucket?: string): string {
  return `mine:${workspaceId}:${artifactId}:${version}:${contentHash8}${dayBucket ? `:d${dayBucket}` : ''}`;
}
