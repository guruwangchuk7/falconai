// Per-repo ACL: within a tenant, a scan scoped to the requester's accessible repos must
// exclude artifacts from a repo they cannot access. This is the query shape retrieve() uses
// on top of the RLS tenant floor.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
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
  await seed('repo-shared', '#1');
  await seed('repo-private', '#2');
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

async function seed(repo: string, ref: string) {
  await tdb.admin`insert into artifact ${tdb.admin(
    { workspace_id: A, user_id: UA, source: 'github', external_ref: ref, type: 'pr', acl_tags: [repo], trust_tier: 'trusted' },
    'workspace_id', 'user_id', 'source', 'external_ref', 'type', 'acl_tags', 'trust_tier',
  )}`;
}

it('a scan scoped to accessible repos excludes the inaccessible repo', async () => {
  const accessible = JSON.stringify(['repo-shared']);
  const rows = await db.withTenant(A, (tx) =>
    tx.select().from(schema.artifact).where(sql`acl_tags @> ${accessible}::jsonb`),
  );
  expect(rows).toHaveLength(1);
  expect((rows[0]!.aclTags as string[]).includes('repo-private')).toBe(false);
});
