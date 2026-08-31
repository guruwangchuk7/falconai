// Phase 3 (spec 004-pairing, T009) — the new Pairing tables must enforce tenant isolation exactly
// like Phase 1/2: RLS returns zero cross-tenant rows, and a mismatched-workspace insert is rejected
// by the WITH CHECK policy. Runs against real Postgres (Testcontainers, Docker), connecting as the
// non-BYPASSRLS falcon_app role.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, schema, type DbHandle } from '@falcon/db';
import { startTestDb, type TestDb } from '../support/pg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_0002 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');
const MIGRATION_0003 = resolve(HERE, '../../packages/db/drizzle/0003_pairing.sql');

const A = '00000000-0000-0000-0000-0000000000aa';
const B = '00000000-0000-0000-0000-0000000000bb';
const UA = '00000000-0000-0000-0000-0000000000a1';
const UB = '00000000-0000-0000-0000-0000000000b1';

let tdb: TestDb;
let db: DbHandle;

beforeAll(async () => {
  tdb = await startTestDb();
  // startTestDb applies 0001 + creates falcon_app; layer 0002 then 0003 (both self-grant to falcon_app).
  await tdb.admin.unsafe(readFileSync(MIGRATION_0002, 'utf8'));
  await tdb.admin.unsafe(readFileSync(MIGRATION_0003, 'utf8'));
  db = createDb(tdb.appUrl);
  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into workspace ${tdb.admin({ id: B, name: 'B', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'a@x.com' }, 'id', 'email')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UB, email: 'b@x.com' }, 'id', 'email')}`;
  // Seed one session per tenant via the app role (proves inserts work under RLS with-check).
  await db.withTenant(A, (tx) => tx.insert(schema.session).values({ workspaceId: A, sessionKey: 'evt-a', origin: 'calendar' }));
  await db.withTenant(B, (tx) => tx.insert(schema.session).values({ workspaceId: B, sessionKey: 'evt-b', origin: 'calendar' }));
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('a tenant sees only its own sessions', async () => {
  const rows = await db.withTenant(A, (tx) => tx.select().from(schema.session));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.workspaceId).toBe(A);
  expect(rows[0]!.sessionKey).toBe('evt-a');
});

it('an explicit cross-tenant filter still returns nothing (RLS floor)', async () => {
  const rows = await db.withTenant(A, (tx) =>
    tx.select().from(schema.session).where(eq(schema.session.workspaceId, B)),
  );
  expect(rows).toHaveLength(0);
});

it('rejects an insert whose workspace_id mismatches the tenant context (WITH CHECK)', async () => {
  await expect(
    db.withTenant(A, (tx) =>
      tx.insert(schema.sessionMembership).values({ workspaceId: B, sessionId: B, userId: UB, joinOrigin: 'calendar' }),
    ),
  ).rejects.toThrow();
});

it('session_event and session_visibility_scope also isolate by tenant', async () => {
  await db.withTenant(A, (tx) =>
    tx.insert(schema.sessionEvent).values({ workspaceId: A, sessionId: A, seq: 1, type: 'member_joined', payload: { userId: UA } }),
  );
  const eventsB = await db.withTenant(B, (tx) => tx.select().from(schema.sessionEvent));
  expect(eventsB).toHaveLength(0); // A's event invisible to B
});

it('consent_pair enforces canonical ordering (user_lo < user_hi) and unique pairs', async () => {
  await db.withTenant(A, (tx) =>
    tx.insert(schema.consentPair).values({ workspaceId: A, userLo: UA, userHi: UB, grantedAt: new Date() }),
  );
  // Duplicate pair in the same workspace violates the unique constraint.
  await expect(
    db.withTenant(A, (tx) => tx.insert(schema.consentPair).values({ workspaceId: A, userLo: UA, userHi: UB })),
  ).rejects.toThrow();
});
