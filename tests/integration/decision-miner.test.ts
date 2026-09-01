import { it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from '../support/pg.js';

let tdb: TestDb;
beforeAll(async () => { tdb = await startTestDb(); }, 180_000);
afterAll(async () => { await tdb.stop(); });

it('0005 applied: mined_artifact table and new columns exist', async () => {
  const cols = await tdb.admin`
    select table_name, column_name from information_schema.columns
    where table_name in ('artifact','decision_record','connection','mined_artifact')
      and column_name in ('state','merged_closed_at','origin','mine_watermark','content_hash')`;
  const set = new Set(cols.map((c: any) => `${c.table_name}.${c.column_name}`));
  expect(set.has('artifact.state')).toBe(true);
  expect(set.has('artifact.merged_closed_at')).toBe(true);
  expect(set.has('decision_record.origin')).toBe(true);
  expect(set.has('connection.mine_watermark')).toBe(true);
  expect(set.has('mined_artifact.content_hash')).toBe(true);
});
