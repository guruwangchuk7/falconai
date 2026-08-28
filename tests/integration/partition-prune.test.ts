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
  // The tenant id comes from current_setting('app.workspace_id'), which is opaque to the planner,
  // so pruning happens at RUN TIME: Postgres builds an Append over all 16 hash partitions and drops
  // the non-matching ones ("Subplans Removed: N"). Static/plan-time pruning would instead print
  // "Partitions removed". Accept either — the correctness bar is that pruning occurred AND the scan
  // touches exactly ONE partition (not a post-filter over all 16).
  expect(plan).toMatch(/Subplans Removed: \d+|Partitions removed/i);
  const scanned = new Set(plan.match(/artifact_p\d+/g) ?? []);
  expect(scanned.size).toBe(1);
});
