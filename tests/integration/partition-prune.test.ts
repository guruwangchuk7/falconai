// Review A2: the tenant predicate must PRUNE partitions (not post-filter), or the ANN path
// degrades silently at scale. Assert the plan prunes for a tenant-scoped scan.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type DbHandle } from '@falcon/db';
import { startTestDb, type TestDb } from '../support/pg.js';

const A = '00000000-0000-0000-0000-0000000000aa';

let tdb: TestDb;
let db: DbHandle;

beforeAll(async () => {
  tdb = await startTestDb();
  db = createDb(tdb.appUrl);
  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('EXPLAIN ANALYZE prunes partitions for a tenant-scoped scan', async () => {
  const plan = await db.withTenant(A, async (tx) => {
    const rows = (await tx.execute(
      sql`explain (analyze, format text) select * from artifact`,
    )) as unknown as Array<Record<string, string>>;
    return rows.map((r) => Object.values(r)[0]).join('\n');
  });
  // 16 hash partitions; the runtime prune shows "Partitions removed" and/or "(never executed)".
  expect(plan).toMatch(/Partitions removed|never executed/i);
});
