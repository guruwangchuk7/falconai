import { Worker } from 'bullmq';
import { getDb } from '@falcon/db';
import { createLlmProviders } from '@falcon/llm';
import { createSecretStore } from '@falcon/secrets';
import { EXTRACTOR_VERSION, reapExpiredWorkingCopies, type CoreDeps } from '@falcon/core';
import { conn, defaultJobOpts, maintenanceQueue, meetingExtractQueue, meetingExtractJobId, mineQueue, mineJobId, type DigestJob, type IndexJob, type MeetingExtractJob, type MineJob, type SyncJob } from '@falcon/queue';
import { captureException, flushObservability, initObservability } from '@falcon/observability';
import { handleDigest, handleIndex, handleMeetingExtract, handleMine, handleSync, msUntilNextUtcMidnight, pollAll, pollDigests } from './handlers.js';

await initObservability();

const deps: CoreDeps = { db: getDb(), llm: createLlmProviders() };
const secrets = createSecretStore();
const connection = conn();

// Index fans out one embedding call per artifact. On Voyage's free tier (3 RPM) a high fan-out
// causes 429 bursts — the provider now retries with backoff, but low-throughput deployments can
// also cap concurrency via INDEX_CONCURRENCY (default 8) to reduce wasted retries.
const indexConcurrency = Number(process.env.INDEX_CONCURRENCY) || 8;
const mineConcurrency = Number(process.env.MINE_CONCURRENCY) || 2;
const meetingExtractConcurrency = Number(process.env.MEETING_EXTRACT_CONCURRENCY) || 2;

const workers = [
  new Worker<SyncJob>('sync', (job) => handleSync(deps, secrets, job.data), { connection, concurrency: 4 }),
  new Worker<IndexJob>('index', (job) => handleIndex(deps, job.data), { connection, concurrency: indexConcurrency }),
  new Worker<DigestJob>('digest', (job) => handleDigest(deps, job.data), { connection, concurrency: 4 }),
  new Worker<MineJob>('mine', async (job) => {
    const out = await handleMine(deps, job.data);
    if (out.result === 'deferred') {
      // Budget-defer re-enqueue: push past the next UTC midnight (when the daily suggestion
      // budget resets), jittered so a burst of deferred jobs doesn't all fire at once, at a
      // higher priority than fresh jobs, and deduped per-day (we don't have the artifact body
      // here to recompute the content hash, so the jobId buckets on the day instead).
      const now = new Date();
      const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      const jitterMs = Math.floor(Math.random() * 15 * 60_000); // spread the 00:00 herd over 15 min
      const delay = (nextMidnight - now.getTime()) + jitterMs;
      const day = new Date(nextMidnight).toISOString().slice(0, 10);
      await mineQueue().add('mine', job.data, {
        ...defaultJobOpts, delay, priority: 1,
        jobId: mineJobId(job.data.workspaceId, job.data.artifactId, EXTRACTOR_VERSION, 'defer', day),
      });
    }
  }, { connection, concurrency: mineConcurrency }),
  new Worker<MeetingExtractJob>('meeting-extract', async (job) => {
    const out = await handleMeetingExtract(deps, job.data);
    if (out.result === 'deferred') {
      // Over the reserved meeting budget: re-enqueue past the next UTC-midnight reset (well within the
      // working-copy TTL, so the transcript survives), jittered, at higher priority, deduped per-day.
      const now = new Date();
      const untilMidnight = msUntilNextUtcMidnight(now);
      const jitterMs = Math.floor(Math.random() * 15 * 60_000);
      const day = new Date(now.getTime() + untilMidnight).toISOString().slice(0, 10);
      await meetingExtractQueue().add('meeting-extract', job.data, {
        ...defaultJobOpts, delay: untilMidnight + jitterMs, priority: 1,
        jobId: `${meetingExtractJobId(job.data.workspaceId, job.data.meetingId)}:defer:${day}`,
      });
    }
  }, { connection, concurrency: meetingExtractConcurrency }),
  new Worker('maintenance', async (job) => {
    if (job.name === 'poll-sync') await pollAll(deps);
    else if (job.name === 'poll-digests') await pollDigests(deps);
    else if (job.name === 'reap-working-copies') await reapExpiredWorkingCopies(deps);
  }, { connection }),
];

for (const w of workers) {
  w.on('failed', (job, err) => {
    console.error(`[${w.name}] job ${job?.id} failed:`, err.message);
    captureException(err, { worker: w.name, jobId: job?.id, jobName: job?.name });
  });
}

// Repeatable maintenance: backfill poll every 10 min; nightly digests at 03:00.
await maintenanceQueue().add('poll-sync', {}, { repeat: { pattern: '*/10 * * * *' }, ...defaultJobOpts });
await maintenanceQueue().add('poll-digests', {}, { repeat: { pattern: '0 3 * * *' }, ...defaultJobOpts });
// Enforce the working-copy TTL (D6 consent promise) — delete transcripts past expires_at every 30 min.
await maintenanceQueue().add('reap-working-copies', {}, { repeat: { pattern: '*/30 * * * *' }, ...defaultJobOpts });

console.log('falcon worker started: sync, index, digest, mine, meeting-extract, maintenance');

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  await flushObservability();
  await connection.quit();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
