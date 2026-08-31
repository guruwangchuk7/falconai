// Phase 3 (spec 004-pairing, T017) — route-level contract test for the pairing REST surface. Runs
// the REAL Next route handlers against REAL Postgres with RLS enforced (falcon_app). Only the auth
// session + deps() singleton are faked. Covers: calendar resolve joins one session, consent-once
// gating, code TTL/limit/unknown, and cross-tenant 404 (RLS floor). Docker required.
import { it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, schema, type DbHandle } from '@falcon/db';
import { startTestDb, type TestDb } from '../support/pg.js';

const h = vi.hoisted(() => ({ session: null as { userId: string; workspaceId: string } | null, db: null as unknown }));

vi.mock('@/lib/session', () => ({ getActiveSession: async () => h.session }));
vi.mock('@/lib/deps', () => ({ deps: () => ({ db: h.db }), secrets: () => { throw new Error('unused'); } }));
vi.mock('@falcon/queue', () => ({ rateLimit: async () => ({ ok: true, remaining: 999 }) }));
vi.mock('@falcon/observability', () => ({ captureException: () => {}, captureEvent: () => {} }));

import { POST as resolvePOST } from '@/app/api/session/resolve/route';
import { POST as joinPOST } from '@/app/api/session/join-by-code/route';
import { POST as codePOST } from '@/app/api/session/[id]/code/route';
import { GET as sessionGET } from '@/app/api/session/[id]/route';
import { POST as consentPOST } from '@/app/api/consent/pair/route';

const HERE = dirname(fileURLToPath(import.meta.url));
const M2 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');
const M3 = resolve(HERE, '../../packages/db/drizzle/0003_pairing.sql');

const A = '00000000-0000-0000-0000-0000000000aa';
const B = '00000000-0000-0000-0000-0000000000bb';
const UA = '00000000-0000-0000-0000-0000000000a1';
const UB = '00000000-0000-0000-0000-0000000000a2';
const UC = '00000000-0000-0000-0000-0000000000b1';

let tdb: TestDb;
let db: DbHandle;

const asUser = (userId: string, workspaceId: string) => { h.session = { userId, workspaceId }; };
const req = (body: unknown) => new Request('http://t/', { method: 'POST', body: JSON.stringify(body) });

beforeAll(async () => {
  tdb = await startTestDb();
  await tdb.admin.unsafe(readFileSync(M2, 'utf8'));
  await tdb.admin.unsafe(readFileSync(M3, 'utf8'));
  db = createDb(tdb.appUrl);
  h.db = db;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('calendar resolve creates one session that both invitees join; consent gates until recorded', async () => {
  asUser(UA, A);
  const r1 = await (await resolvePOST(req({ calendarEventId: 'evt-1' }))).json();
  expect(r1.origin).toBe('calendar');
  expect(r1.needsConsent).toBe(false); // UA alone

  asUser(UB, A);
  const r2 = await (await resolvePOST(req({ calendarEventId: 'evt-1' }))).json();
  expect(r2.sessionId).toBe(r1.sessionId); // same session — auto-pair by calendar id
  expect(r2.needsConsent).toBe(true); // UA present, no consent yet

  // Record UA↔UB consent (symmetric via canonical pair), then UB re-resolves.
  asUser(UA, A);
  const c = await consentPOST(req({ otherUserId: UB, granted: true }));
  expect(c.status).toBe(200);
  asUser(UB, A);
  const r3 = await (await resolvePOST(req({ calendarEventId: 'evt-1' }))).json();
  expect(r3.needsConsent).toBe(false);
});

it('a minted code lets another member join; unknown/expired/over-limit are rejected', async () => {
  asUser(UA, A);
  const sess = await (await resolvePOST(req({ calendarEventId: 'evt-code' }))).json();
  const mint = await (await codePOST(req({}), { params: Promise.resolve({ id: sess.sessionId }) })).json();
  expect(mint.code).toMatch(/^[A-Z0-9]{6}$/);

  asUser(UB, A);
  const joined = await (await joinPOST(req({ code: mint.code }))).json();
  expect(joined.sessionId).toBe(sess.sessionId);

  const unknown = await joinPOST(req({ code: 'ZZZZZZ' }));
  expect(unknown.status).toBe(404);

  // Force-expire a code directly, then join → 410.
  await db.withTenant(A, (tx) =>
    tx.insert(schema.sessionCode).values({
      workspaceId: A, sessionId: sess.sessionId, code: 'EXPIRE', createdBy: UA, expiresAt: new Date(Date.now() - 1000),
    }),
  );
  const expired = await joinPOST(req({ code: 'EXPIRE' }));
  expect(expired.status).toBe(410);
});

it('a cross-tenant session id is invisible (RLS floor → 404)', async () => {
  asUser(UA, A);
  const sess = await (await resolvePOST(req({ calendarEventId: 'evt-x' }))).json();
  asUser(UC, B); // different workspace
  const res = await sessionGET(new Request('http://t/'), { params: Promise.resolve({ id: sess.sessionId }) });
  expect(res.status).toBe(404);
});
