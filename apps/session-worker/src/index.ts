import Fastify from 'fastify';

/**
 * Falcon session worker (Phase 3 scaffold) — the stateful per-session unit: WebSocket audio ingest
 * → STT → transcript merge → open-thread tracking, event-sourced to Redis with lease + fencing-token
 * ownership (PRD §6.3, §12.5). The Foundational modules land in Phase 2 of tasks.md:
 *   - eventlog.ts   (T010) Redis Streams append-before-action + snapshot/replay fold (CX-1)
 *   - ownership.ts  (T012) lease + monotonic fencing token; symmetric reconciler recovery (R14)
 *   - server.ts     (T014) WS ingest + consistent-hash session pinning
 *   - merge.ts      (T023) server-arrival ordering + gap-mark  [GATED on the G2 AD-1 spike]
 *   - visibility.ts (T032) session_visibility_scope = ACL intersection (F9.1a)
 *   - agents.ts     (T033) one Participant Agent per human (in-worker async task)
 *   - threads.ts    (T037) Open Threads table as a fold (F6.1a, CX-1)
 *
 * Strictly plumbing: this worker publishes NO mediation cards or private nudges (Phase 4,
 * FR-023/FR-026). Text-only; never emits audio (§3.2).
 */
const PORT = Number(process.env.PORT) || 8787;

const app = Fastify({ logger: true });

app.get('/health', () => ({ status: 'ok', service: 'falcon-session-worker' }));

await app.listen({ port: PORT, host: '0.0.0.0' });
