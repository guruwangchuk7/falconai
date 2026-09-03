import { it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startTestDb, type TestDb } from '../support/pg.js';

let tdb: TestDb;
let app: ReturnType<typeof postgres>;
const WS_A = '11111111-1111-1111-1111-111111111111';
const WS_B = '22222222-2222-2222-2222-222222222222';

beforeAll(async () => {
  tdb = await startTestDb(); // startTestDb applies 0006 (see tests/support/pg.ts), matching the 0004/0005 convention.
  // Seed one meeting per workspace as admin (bypasses RLS).
  for (const ws of [WS_A, WS_B]) {
    await tdb.admin`insert into workspace (id, name) values (${ws}, ${'ws-' + ws.slice(0, 4)}) on conflict do nothing`;
    await tdb.admin`insert into meeting (workspace_id, session_id, ended_at, attendees)
                    values (${ws}, gen_random_uuid(), now(), ${tdb.admin.json([])})`;
  }
  app = postgres(tdb.appUrl, { prepare: false });
}, 120_000);

afterAll(async () => { await app?.end(); await tdb?.stop(); });

// set_config(..., true) is transaction-local: it must run in the SAME transaction as the query
// that depends on it, or the setting evaporates the instant its own autocommit statement ends
// (mirrors why packages/db/src/tenant.ts's withTenant wraps both in one transaction).
async function asTenant<T>(ws: string, fn: (sql: typeof app) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.workspace_id', ${ws}, true)`;
    return fn(tx as unknown as typeof app);
  })) as T;
}

it('meeting is tenant-isolated: workspace A cannot see workspace B rows', async () => {
  const rows = await asTenant(WS_A, (sql) => sql`select workspace_id from meeting`);
  expect(rows.length).toBe(1);
  expect(rows[0]!.workspace_id).toBe(WS_A);
});

it('decision_record.visibility defaults to workspace', async () => {
  const [col] = await tdb.admin`
    select column_default from information_schema.columns
    where table_name = 'decision_record' and column_name = 'visibility'`;
  expect(String(col!.column_default)).toContain('workspace');
});

it('workspace.meeting_retention_days defaults to 0 (retention off)', async () => {
  const [col] = await tdb.admin`
    select column_default from information_schema.columns
    where table_name = 'workspace' and column_name = 'meeting_retention_days'`;
  expect(String(col!.column_default)).toContain('0');
});

it('decision_span and meeting_transcript and mined_meeting exist and are RLS-forced', async () => {
  const rows = await tdb.admin`
    select relname from pg_class
    where relname in ('decision_span','meeting_transcript','mined_meeting') and relrowsecurity and relforcerowsecurity`;
  expect(rows.map((r) => r.relname).sort()).toEqual(['decision_span', 'meeting_transcript', 'mined_meeting']);
});
