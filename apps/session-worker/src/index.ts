import { conn } from '@falcon/queue';
import { createSttProvider } from '@falcon/stt';
import { startSessionWorker } from './server.js';

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

const app = startSessionWorker({
  redis: conn(),
  stt: createSttProvider(),
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
});

await app.listen({ port: PORT, host: '0.0.0.0' });
