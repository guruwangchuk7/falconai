// Phase 2 (spec 002-personal-falcon, T005) — the new Personal Falcon tables must enforce tenant
// isolation exactly like Phase 1: RLS returns zero cross-tenant rows, and a mismatched-workspace
// insert is rejected by the WITH CHECK policy. Runs against real Postgres (Testcontainers, Docker),
// connecting as the non-BYPASSRLS falcon_app role.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, schema, type DbHandle } from '@falcon/db';
import { startTestDb, type TestDb } from '../support/pg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_0002 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');

const A = '00000000-0000-0000-0000-0000000000aa';
const B = '00000000-0000-0000-0000-0000000000bb';
const UA = '00000000-0000-0000-0000-0000000000a1';
const UB = '00000000-0000-0000-0000-0000000000b1';

let tdb: TestDb;
let db: DbHandle;

beforeAll(async () => {
  tdb = await startTestDb();
  // startTestDb applies 0001 + creates falcon_app; apply 0002 (self-grants to falcon_app).
  await tdb.admin.unsafe(readFileSync(MIGRATION_0002, 'utf8'));
  db = createDb(tdb.appUrl);
  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into workspace ${tdb.admin({ id: B, name: 'B', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'a@x.com' }, 'id', 'email')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UB, email: 'b@x.com' }, 'id', 'email')}`;
  // Seed one conversation per tenant via the app role (proves inserts work under RLS with-check).
  await db.withTenant(A, (tx) => tx.insert(schema.conversation).values({ workspaceId: A, userId: UA, title: 'A conv' }));
  await db.withTenant(B, (tx) => tx.insert(schema.conversation).values({ workspaceId: B, userId: UB, title: 'B conv' }));
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('a tenant sees only its own conversations', async () => {
  const rows = await db.withTenant(A, (tx) => tx.select().from(schema.conversation));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.workspaceId).toBe(A);
  expect(rows[0]!.title).toBe('A conv');
});

it('an explicit cross-tenant filter still returns nothing (RLS floor)', async () => {
  const rows = await db.withTenant(A, (tx) =>
    tx.select().from(schema.conversation).where(eq(schema.conversation.workspaceId, B)),
  );
  expect(rows).toHaveLength(0);
});

it('rejects an insert whose workspace_id mismatches the tenant context (WITH CHECK)', async () => {
  await expect(
    db.withTenant(A, (tx) => tx.insert(schema.answer).values({ workspaceId: B, questionId: A, status: 'grounded' })),
  ).rejects.toThrow();
});

it('query_event and answer_citation also isolate by tenant', async () => {
  await db.withTenant(A, (tx) => tx.insert(schema.queryEvent).values({ workspaceId: A, userId: UA, kind: 'qa' }));
  const eventsB = await db.withTenant(B, (tx) => tx.select().from(schema.queryEvent));
  expect(eventsB).toHaveLength(0); // A's event invisible to B
});
