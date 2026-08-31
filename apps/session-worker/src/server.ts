import type { IncomingMessage } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Redis } from 'ioredis';
import type { SttProvider, SttStream } from '@falcon/stt';
import { createEventLog, type EventLog } from './eventlog.js';
import { createOwnership, type Ownership, ownerFor } from './ownership.js';

/** Build the Fastify app (health + readiness). Kept separate so it is injectable in tests. */
export function createSessionApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/health', () => ({ status: 'ok', service: 'falcon-session-worker' }));
  return app;
}

/**
 * Lease-guarded ingest loop for ONE client stream. Consumes STT finals and appends an
 * `utterance_final` event attributed to the CONNECTION OWNER — never voice-inferred (§6.1/G2) — but
 * ONLY while this worker still holds the session lease (lease-holder-only writes, §12.5). If the
 * lease is lost mid-session (another worker claimed it), appends stop immediately: a zombie worker
 * cannot write. Raw audio is never persisted — only the finalized transcript event is (§12.3/R6).
 */
export async function runIngest(
  stream: SttStream,
  userId: string,
  eventLog: EventLog,
  ownership: Ownership,
): Promise<void> {
  for await (const ev of stream.events()) {
    if (ev.kind !== 'final') continue;
    if (!(await ownership.isOwner())) return; // lost the lease → stop writing (split-brain guard)
    await eventLog.append('utterance_final', {
      userId, // attribution by construction (the connection's owner)
      clientSeq: ev.data.clientSeq,
      text: ev.data.text,
    });
  }
}

/** Parse `/session/{id}/connect?userId=…` from the upgrade request. */
export function parseConnUrl(url: string | undefined): { sessionId: string; userId: string } | null {
  if (!url) return null;
  const u = new URL(url, 'http://localhost');
  const m = /^\/session\/([^/]+)\/connect$/.exec(u.pathname);
  const userId = u.searchParams.get('userId');
  if (!m || !m[1] || !userId) return null;
  return { sessionId: m[1], userId };
}

export interface SessionWorkerDeps {
  redis: Redis;
  stt: SttProvider;
  workerId: string;
  /** The live worker set, for consistent-hash pinning (a session is served by ownerFor(id, workers)). */
  liveWorkers?: readonly string[];
}

/**
 * Wire the WebSocket ingest onto the HTTP server. Each `/session/{id}/connect` connection: verifies
 * this worker should own the session (consistent-hash pinning, §6.3), claims the lease + fencing
 * token (§12.5), opens an STT stream for the connection's user, forwards VAD-gated audio frames to
 * it, and runs the lease-guarded ingest loop. Returns the Fastify app (already listening is caller's
 * job). The full protocol (resync, fencing pushes, panel SSE) is completed in User Story 1.
 */
export function attachSessionWs(app: FastifyInstance, deps: SessionWorkerDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  app.server.on('upgrade', (req, socket, head) => {
    const parsed = parseConnUrl(req.url);
    if (!parsed) {
      socket.destroy();
      return;
    }
    // Consistent-hash pinning: only the worker this session maps to should serve it (§6.3).
    const workers = deps.liveWorkers ?? [deps.workerId];
    if (ownerFor(parsed.sessionId, workers) !== deps.workerId) {
      socket.destroy(); // wrong worker; client retries and lands on the right one
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const parsed = parseConnUrl(req.url)!;
    const { sessionId, userId } = parsed;
    const ownership = createOwnership(deps.redis, sessionId, deps.workerId);
    const eventLog = createEventLog(deps.redis, sessionId);

    void (async () => {
      const token = await ownership.claim();
      if (token === null) {
        ws.close(1013, 'not session owner'); // another live worker holds the lease
        return;
      }
      const stream = deps.stt.openStream({ userId });
      ws.on('message', (data, isBinary) => {
        if (isBinary) stream.pushAudio(new Uint8Array(data as Buffer), 0); // seq wired in US1
      });
      ws.on('close', () => void stream.close());
      await runIngest(stream, userId, eventLog, ownership);
    })();
  });

  return wss;
}

/** Convenience bootstrap: an HTTP server with /health + the WS ingest attached. */
export function startSessionWorker(deps: SessionWorkerDeps): FastifyInstance {
  const app = createSessionApp();
  attachSessionWs(app, deps);
  return app;
}
