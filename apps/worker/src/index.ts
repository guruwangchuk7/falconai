import { Worker } from 'bullmq';
import { getDb } from '@falcon/db';
import { createLlmProviders } from '@falcon/llm';
import { createSecretStore } from '@falcon/secrets';
import type { CoreDeps } from '@falcon/core';
import { connection } from './redis.js';
import { defaultJobOpts, maintenanceQueue, type DigestJob, type IndexJob, type SyncJob } from './queues.js';
import { handleDigest, handleIndex, handleSync, pollAll, pollDigests } from './handlers.js';

const deps: CoreDeps = { db: getDb(), llm: createLlmProviders() };
const secrets = createSecretStore();

const workers = [
  new Worker<SyncJob>('sync', (job) => handleSync(deps, secrets, job.data), { connection, concurrency: 4 }),
  new Worker<IndexJob>('index', (job) => handleIndex(deps, job.data), { connection, concurrency: 8 }),
  new Worker<DigestJob>('digest', (job) => handleDigest(deps, job.data), { connection, concurrency: 4 }),
  new Worker('maintenance', async (job) => {
    if (job.name === 'poll-sync') await pollAll(deps);
    else if (job.name === 'poll-digests') await pollDigests(deps);
  }, { connection }),
];

for (const w of workers) {
  w.on('failed', (job, err) => console.error(`[${w.name}] job ${job?.id} failed:`, err.message));
}

// Repeatable maintenance: backfill poll every 10 min; nightly digests at 03:00.
await maintenanceQueue.add('poll-sync', {}, { repeat: { pattern: '*/10 * * * *' }, ...defaultJobOpts });
await maintenanceQueue.add('poll-digests', {}, { repeat: { pattern: '0 3 * * *' }, ...defaultJobOpts });

console.log('falcon worker started: sync, index, digest, maintenance');

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
