import { conn } from '@falcon/queue';
import { createSttProvider } from '@falcon/stt';
import { getDb } from '@falcon/db';
import { startSessionWorker } from './server.js';
import { assembleAndEnqueue } from './meeting-end.js';

/**
 * Falcon session worker entrypoint (Phase 3) — the stateful per-session unit: WebSocket audio ingest
 * → STT → transcript merge → open-thread tracking, event-sourced to Redis with lease + fencing-token
 * ownership (PRD §6.3, §12.5). Wires the shared substrate:
 *   - eventlog.ts   append-before-action Redis-Stream log + fold replay (CX-1)          [done]
 *   - ownership.ts  lease + monotonic fencing token + reconciler (R14)                  [done]
 *   - server.ts     WS ingest + consistent-hash pinning + lease-holder-only writes      [done]
 *   - merge.ts      server-arrival ordering + gap-mark  [GATED on the G2 AD-1 spike]    [pending]
 *   - threads.ts / agents.ts / visibility.ts            (User Stories 2–3)              [pending]
 *
 * Strictly plumbing: publishes NO mediation cards or private nudges (Phase 4, FR-023/FR-026).
 */
const PORT = Number(process.env.PORT) || 8787;

const redis = conn();
const hasDb = !!(process.env.APP_DATABASE_URL || process.env.DATABASE_URL);
const onMeetingEnd = hasDb
  ? async (sessionId: string) => { await assembleAndEnqueue({ db: getDb() }, redis, sessionId); }
  : undefined;
if (!hasDb) console.log('[falcon] meeting-end capture disabled (no DATABASE_URL/APP_DATABASE_URL)');

// Optional env overrides for the meeting-end timers (D8). Defaults (config) are the product values —
// a 2-min idle-reconnect grace and a 4-hour hard cap. A shorter grace is useful for local testing so
// a meeting ends promptly after the app closes instead of waiting out the full reconnect window.
const meetingIdleGraceMs = Number(process.env.MEETING_IDLE_GRACE_MS) || undefined;
const meetingMaxSessionMs = Number(process.env.MEETING_MAX_SESSION_MS) || undefined;

const app = startSessionWorker({
  redis,
  stt: createSttProvider(),
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
  ...(onMeetingEnd ? { onMeetingEnd } : {}),
  ...(meetingIdleGraceMs ? { meetingIdleGraceMs } : {}),
  ...(meetingMaxSessionMs ? { meetingMaxSessionMs } : {}),
});

await app.listen({ port: PORT, host: '0.0.0.0' });
// The Fastify logger is off (keeps the hot path quiet), so print one line to confirm it's up.
console.log(`[falcon] session worker listening on http://127.0.0.1:${PORT} — STT: ${process.env.FALCON_FAKE_STT ? 'fake' : 'deepgram'}`);
