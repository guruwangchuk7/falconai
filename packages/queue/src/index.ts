import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { loadEnv, redisEnv } from '@falcon/config';
import type { ArtifactInput } from '@falcon/integrations';

// Lazy getters so importing this package (e.g. in a Next.js route module) does NOT open a Redis
// connection at import/build time — only on first actual use.

export interface SyncJob { workspaceId: string; connectionId: string; delta?: ArtifactInput[] }
export interface IndexJob { workspaceId: string; artifactId: string }
export interface DigestJob { workspaceId: string; userId: string }

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

let _sync: Queue<SyncJob> | undefined;
let _index: Queue<IndexJob> | undefined;
let _digest: Queue<DigestJob> | undefined;
let _maint: Queue | undefined;

export const syncQueue = (): Queue<SyncJob> => (_sync ??= new Queue<SyncJob>('sync', { connection: conn() }));
export const indexQueue = (): Queue<IndexJob> => (_index ??= new Queue<IndexJob>('index', { connection: conn() }));
export const digestQueue = (): Queue<DigestJob> => (_digest ??= new Queue<DigestJob>('digest', { connection: conn() }));
export const maintenanceQueue = (): Queue => (_maint ??= new Queue('maintenance', { connection: conn() }));
