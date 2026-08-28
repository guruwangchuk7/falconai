import { Queue } from 'bullmq';
import type { ArtifactInput } from '@falcon/integrations';
import { connection } from './redis.js';

export interface SyncJob { workspaceId: string; connectionId: string; delta?: ArtifactInput[] }
export interface IndexJob { workspaceId: string; artifactId: string }
export interface DigestJob { workspaceId: string; userId: string }

export const syncQueue = new Queue<SyncJob>('sync', { connection });
export const indexQueue = new Queue<IndexJob>('index', { connection });
export const digestQueue = new Queue<DigestJob>('digest', { connection });
export const maintenanceQueue = new Queue('maintenance', { connection });

export const defaultJobOpts = { attempts: 5, backoff: { type: 'exponential' as const, delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 };
