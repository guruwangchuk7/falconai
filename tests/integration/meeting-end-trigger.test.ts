import { it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { FakeSttProvider } from '@falcon/stt';
import { startSessionWorker } from '../../apps/session-worker/src/server.js';
import { startTestRedis, type TestRedis } from '../support/redis.js';

let tr: TestRedis; let redis: Redis; let app: FastifyInstance; let port = 0;
const ended: string[] = [];              // spy: sessionIds whose meeting ended
const GRACE = 200, CAP = 600;

beforeAll(async () => {
  tr = await startTestRedis();
  redis = new Redis(tr.url, { maxRetriesPerRequest: null });
  app = startSessionWorker({
    redis, stt: new FakeSttProvider(), workerId: 'wA', liveWorkers: ['wA'],
    meetingIdleGraceMs: GRACE, meetingMaxSessionMs: CAP,
    onMeetingEnd: async (sid) => { ended.push(sid); },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
}, 120_000);

afterAll(async () => { await app.close(); redis.disconnect(); await tr.stop(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Open a client for a session; returns the socket + a live list of messages it received. */
function open(sessionId: string): Promise<{ ws: WebSocket; msgs: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/session/${sessionId}/connect?userId=u1`);
    const msgs: any[] = [];
    ws.on('message', (d, isBinary) => { if (!isBinary) { try { msgs.push(JSON.parse(d.toString())); } catch {} } });
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('error', reject);
  });
}

it('explicit end_meeting fires onMeetingEnd once and notifies the client', async () => {
  const { ws, msgs } = await open('s-explicit');
  ws.send(JSON.stringify({ type: 'end_meeting' }));
  await sleep(150);
  expect(ended.filter((s) => s === 's-explicit')).toHaveLength(1);
  expect(msgs.some((m) => m.type === 'meeting_ended' && m.reason === 'explicit')).toBe(true);
  ws.close();
});

it('idle disconnect fires after the grace window', async () => {
  const { ws } = await open('s-idle');
  ws.close();
  await sleep(GRACE + 150);
  expect(ended.filter((s) => s === 's-idle')).toHaveLength(1);
});

it('a reconnect within the grace window cancels the idle end', async () => {
  const a = await open('s-recon');
  a.ws.close();
  await sleep(GRACE / 2);
  const b = await open('s-recon');       // reconnect before grace elapses
  await sleep(GRACE + 100);
  expect(ended.filter((s) => s === 's-recon')).toHaveLength(0); // not ended — still connected
  b.ws.close();
  await sleep(GRACE + 150);
  expect(ended.filter((s) => s === 's-recon')).toHaveLength(1); // now idle-ends
});

it('the session-length cap ends a still-open session', async () => {
  const { ws } = await open('s-cap');
  await sleep(CAP + 200);                 // stay connected past the cap
  expect(ended.filter((s) => s === 's-cap')).toHaveLength(1);
  ws.close();
});

it('end_meeting is idempotent (double send fires once)', async () => {
  const { ws } = await open('s-double');
  ws.send(JSON.stringify({ type: 'end_meeting' }));
  ws.send(JSON.stringify({ type: 'end_meeting' }));
  await sleep(150);
  expect(ended.filter((s) => s === 's-double')).toHaveLength(1);
  ws.close();
});

it('two connections on one session: end_meeting fires onMeetingEnd exactly once', async () => {
  const a = await open('s-multi');
  const b = await open('s-multi');
  b.ws.send(JSON.stringify({ type: 'end_meeting' }));
  await sleep(250);
  expect(ended.filter((s) => s === 's-multi')).toHaveLength(1);
  a.ws.close(); b.ws.close();
});
