// SC-003 — tenant isolation is blocker-class. RLS must return zero cross-tenant rows even
// against an explicit cross-tenant filter. Runs against real Postgres (Testcontainers, Docker).
import { it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema, type DbHandle } from '@falcon/db';
import { startTestDb, type TestDb } from '../support/pg.js';

const A = '00000000-0000-0000-0000-0000000000aa';
const B = '00000000-0000-0000-0000-0000000000bb';
const UA = '00000000-0000-0000-0000-0000000000a1';
const UB = '00000000-0000-0000-0000-0000000000b1';

let tdb: TestDb;
let db: DbHandle;

beforeAll(async () => {
  tdb = await startTestDb();
  db = createDb(tdb.appUrl);
  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into workspace ${tdb.admin({ id: B, name: 'B', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'a@x.com' }, 'id', 'email')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UB, email: 'b@x.com' }, 'id', 'email')}`;
  await seedArtifact(A, UA, 'repo-a', '#1');
  await seedArtifact(B, UB, 'repo-b', '#2');
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

async function seedArtifact(ws: string, user: string, repo: string, ref: string) {
  await tdb.admin`insert into artifact ${tdb.admin(
    { workspace_id: ws, user_id: user, source: 'github', external_ref: ref, type: 'pr', acl_tags: [repo], trust_tier: 'trusted' },
    'workspace_id', 'user_id', 'source', 'external_ref', 'type', 'acl_tags', 'trust_tier',
  )}`;
}

it('a tenant sees only its own artifacts', async () => {
  const rows = await db.withTenant(A, (tx) => tx.select().from(schema.artifact));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.workspaceId).toBe(A);
});

it('an explicit cross-tenant filter still returns nothing (RLS floor)', async () => {
  const rows = await db.withTenant(A, (tx) =>
    tx.select().from(schema.artifact).where(eq(schema.artifact.workspaceId, B)),
  );
  expect(rows).toHaveLength(0);
});
