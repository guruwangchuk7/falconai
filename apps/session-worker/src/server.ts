import type { IncomingMessage } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Redis } from 'ioredis';
import type { SttProvider, SttStream } from '@falcon/stt';
import { createEventLog, type EventLog } from '@falcon/session-core';
import { createOwnership, type Ownership, ownerFor } from './ownership.js';
import { MEETING_IDLE_GRACE_MS, MEETING_MAX_SESSION_MS } from '@falcon/config';

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
/** Default per-utterance ordering uncertainty until the desktop client reports real per-connection
 *  jitter/RTT variance (T021). merge.ts uses this to mark ambiguous ordering (F5.3). */
const DEFAULT_ERROR_MARGIN_MS = 250;

export interface IngestCallbacks {
  /** Push an interim/final transcript back to the originating client (contracts/ws-client-worker.md). */
  onEvent?: (msg: { type: 'stt_interim' | 'stt_final'; userId: string; clientSeq: number; text: string }) => void;
}

export async function runIngest(
  stream: SttStream,
  userId: string,
  eventLog: EventLog,
  ownership: Ownership,
  cb: IngestCallbacks = {},
): Promise<void> {
  for await (const ev of stream.events()) {
    if (ev.kind === 'interim') {
      cb.onEvent?.({ type: 'stt_interim', userId, clientSeq: ev.data.clientSeq, text: ev.data.text });
      continue;
    }
    if (ev.kind !== 'final') continue;
    if (!(await ownership.isOwner())) return; // lost the lease → stop writing (split-brain guard)
    await eventLog.append('utterance_final', {
      userId, // attribution by construction (the connection's owner)
      clientSeq: ev.data.clientSeq,
      text: ev.data.text,
      arrivalTs: Date.now(), // server-arrival ordering key (AD-1 / research R1)
      errorMarginMs: DEFAULT_ERROR_MARGIN_MS,
    });
    cb.onEvent?.({ type: 'stt_final', userId, clientSeq: ev.data.clientSeq, text: ev.data.text });
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
  /** Called once when a session's meeting ends (explicit end / idle / cap). Injected in tests; wired to
   *  assembleAndEnqueue in index.ts. Absent → meeting-end capture disabled. */
  onMeetingEnd?: (sessionId: string) => Promise<void>;
  meetingIdleGraceMs?: number;  // default MEETING_IDLE_GRACE_MS
  meetingMaxSessionMs?: number; // default MEETING_MAX_SESSION_MS
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

  const graceMs = deps.meetingIdleGraceMs ?? MEETING_IDLE_GRACE_MS;
  const capMs = deps.meetingMaxSessionMs ?? MEETING_MAX_SESSION_MS;

  interface Lifecycle { conns: Set<WebSocket>; graceTimer?: ReturnType<typeof setTimeout>; capTimer?: ReturnType<typeof setTimeout>; ended: boolean }
  const lifecycles = new Map<string, Lifecycle>();

  // End a meeting exactly once: mark ended synchronously (concurrent triggers no-op), clear timers,
  // notify remaining clients, then fire onMeetingEnd. All connections for a session land on this owner
  // worker (consistent-hash pinning), so per-worker in-memory tracking is authoritative.
  const triggerEnd = (sessionId: string, reason: 'explicit' | 'idle' | 'cap') => {
    const lc = lifecycles.get(sessionId);
    if (!lc || lc.ended) return;
    lc.ended = true;
    if (lc.graceTimer) clearTimeout(lc.graceTimer);
    if (lc.capTimer) clearTimeout(lc.capTimer);
    for (const w of lc.conns) if (w.readyState === 1 /* OPEN */) w.send(JSON.stringify({ type: 'meeting_ended', reason }));
    lifecycles.delete(sessionId);
    void Promise.resolve(deps.onMeetingEnd?.(sessionId)).catch((err) =>
      console.error(`[session ${sessionId}] meeting-end failed:`, err instanceof Error ? err.message : err));
  };

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

    // Registered synchronously — BEFORE the async lease claim below — because a client can send
    // end_meeting, push audio, or close the instant it sees 'open', racing ahead of the claim's
    // Redis round-trip. Node delivers 'message'/'close' only to listeners that exist at emit time,
    // so anything attached after the `await` can silently miss an event that already fired.
    let stream: SttStream | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const audioBacklog: Uint8Array[] = [];
    let endRequested = false;
    let closedEarly = false;
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const frame = new Uint8Array(data as Buffer);
        if (stream) stream.pushAudio(frame, 0); else audioBacklog.push(frame);
        return;
      }
      try {
        const msg = JSON.parse(data.toString()) as { type?: string };
        if (msg?.type === 'end_meeting') { endRequested = true; triggerEnd(sessionId, 'explicit'); }
      } catch { /* ignore malformed control frames */ }
    });
    const onDisconnect = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (stream) void stream.close();
      const cur = lifecycles.get(sessionId);
      if (cur && !cur.ended) {
        cur.conns.delete(ws);
        if (cur.conns.size === 0 && !cur.graceTimer) {
          cur.graceTimer = setTimeout(() => triggerEnd(sessionId, 'idle'), graceMs);
        }
      }
    };
    ws.on('close', () => { closedEarly = true; onDisconnect(); });

    void (async () => {
      const token = await ownership.claim();
      if (token === null) {
        ws.close(1013, 'not session owner'); // another live worker holds the lease
        return;
      }
      // Register in the session lifecycle (meeting-end triggers, B4).
      let lc = lifecycles.get(sessionId);
      if (!lc) { lc = { conns: new Set(), ended: false }; lifecycles.set(sessionId, lc); }
      lc.conns.add(ws);
      if (lc.graceTimer) { clearTimeout(lc.graceTimer); delete lc.graceTimer; } // reconnect cancels idle-end
      if (!lc.capTimer) lc.capTimer = setTimeout(() => triggerEnd(sessionId, 'cap'), capMs);
      if (endRequested) triggerEnd(sessionId, 'explicit'); // end_meeting raced ahead of the claim
      if (closedEarly) { onDisconnect(); return; } // the client vanished before the claim resolved
      // Renew the lease on a heartbeat while the connection is alive — otherwise it expires (~3s TTL)
      // and runIngest's split-brain guard stops forwarding transcripts mid-session.
      heartbeat = setInterval(() => {
        void ownership.renew();
      }, 1000);
      stream = deps.stt.openStream({ userId });
      for (const frame of audioBacklog.splice(0)) stream.pushAudio(frame, 0);
      // PRIVACY (PRD §9.3): a person's raw transcript goes back ONLY to that person — never to other
      // panels. The only thing ever broadcast to everyone is a grounded, blame-neutral CARD (Phase 4,
      // F9). The full transcript still flows into the session event log for the Coordinator to read.
      await runIngest(stream, userId, eventLog, ownership, {
        onEvent: (msg) => {
          if (ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(msg));
        },
      });
      if (heartbeat) clearInterval(heartbeat);
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
