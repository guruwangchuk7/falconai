// Phase 3 (spec 004-pairing, T018) — the client↔worker WebSocket contract (contracts/ws-client-worker.md):
// a connection to a session this worker owns is accepted; a malformed connect URL is rejected. Boots
// the real worker WS server + a real ws client against a Testcontainers Redis. (Attribution is proven
// in T019; fencing/resync are client-side, wired with the desktop client in T021.)
import { it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { FakeSttProvider } from '@falcon/stt';
import { startSessionWorker } from '../../apps/session-worker/src/server.js';
import { startTestRedis, type TestRedis } from '../support/redis.js';

let tr: TestRedis;
let redis: Redis;
let app: FastifyInstance;
let port = 0;

beforeAll(async () => {
  tr = await startTestRedis();
  redis = new Redis(tr.url, { maxRetriesPerRequest: null });
  app = startSessionWorker({ redis, stt: new FakeSttProvider(), workerId: 'wA', liveWorkers: ['wA'] });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
}, 120_000);

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await tr.stop();
});

const connect = (path: string): Promise<{ opened: boolean }> =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    let opened = false;
    ws.on('open', () => {
      opened = true;
      ws.close();
    });
    ws.on('close', () => resolve({ opened }));
    ws.on('error', () => resolve({ opened }));
    setTimeout(() => resolve({ opened }), 2500);
  });

it('accepts a WS connection for a session this worker owns', async () => {
  const r = await connect('/session/sess-ok/connect?userId=uA');
  expect(r.opened).toBe(true);
});

it('rejects a malformed connect URL (missing userId)', async () => {
  const r = await connect('/session/sess-x/connect');
  expect(r.opened).toBe(false);
});
