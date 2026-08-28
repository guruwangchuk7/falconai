// RLS is FAIL-CLOSED: a query with no tenant context set returns zero rows. This is the guard
// that makes a forgotten withTenant (or a session-mode pooling leak) safe rather than a breach.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, schema, type DbHandle } from '@falcon/db';
import { startTestDb, type TestDb } from '../support/pg.js';

const A = '00000000-0000-0000-0000-0000000000aa';
const UA = '00000000-0000-0000-0000-0000000000a1';

let tdb: TestDb;
let db: DbHandle;

beforeAll(async () => {
  tdb = await startTestDb();
  db = createDb(tdb.appUrl);
  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'a@x.com' }, 'id', 'email')}`;
  await tdb.admin`insert into artifact ${tdb.admin(
    { workspace_id: A, user_id: UA, source: 'github', external_ref: '#1', type: 'pr', acl_tags: ['repo-a'], trust_tier: 'trusted' },
    'workspace_id', 'user_id', 'source', 'external_ref', 'type', 'acl_tags', 'trust_tier',
  )}`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('no tenant context → zero rows (fail-closed)', async () => {
  const rows = await db.rootDb.select().from(schema.artifact); // no withTenant → app.workspace_id unset
  expect(rows).toHaveLength(0);
});

it('with tenant context → rows become visible', async () => {
  const rows = await db.withTenant(A, (tx) => tx.select().from(schema.artifact));
  expect(rows.length).toBeGreaterThan(0);
});
