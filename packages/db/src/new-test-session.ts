/**
 * Dev helper: seed a fresh live-meeting test session and print the exact FALCON_WORKER_WS line to
 * point the desktop app at it. The in-meeting listener needs a real Postgres session bound to a
 * workspace (the desktop MVP doesn't persist one), and `meeting` is unique per session — so each
 * live test needs a NEW session id. This makes that one command instead of hand-written SQL.
 *
 *   pnpm --filter @falcon/db new-test-session
 *
 * Uses the first membership by default; override with FALCON_TEST_WORKSPACE_ID / FALCON_TEST_USER_ID.
 * Connects as the migration owner (DATABASE_URL) so it can insert regardless of RLS.
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (run with --env-file=.env or export it).');
  process.exit(1);
}

const sql = postgres(url, { prepare: false });

try {
  let workspaceId = process.env.FALCON_TEST_WORKSPACE_ID ?? null;
  let userId = process.env.FALCON_TEST_USER_ID ?? null;

  if (!workspaceId || !userId) {
    const [row] = await sql<{ workspace_id: string; user_id: string }[]>`
      select workspace_id, user_id from membership order by created_at asc limit 1`;
    if (!row) {
      console.error('No membership found — seed a workspace + user first.');
      process.exit(1);
    }
    workspaceId ??= row.workspace_id;
    userId ??= row.user_id;
  }

  const [session] = await sql<{ id: string }[]>`
    insert into session (workspace_id, session_key, origin, status, started_at)
    values (${workspaceId}, ${'live-test-' + Date.now()}, 'code', 'active', now())
    returning id`;
  const sessionId = session!.id;

  await sql`
    insert into session_membership (workspace_id, session_id, user_id, role_profile, join_origin, consent_state)
    values (${workspaceId}, ${sessionId}, ${userId}, 'engineer', 'code', 'granted')`;

  const wsUrl = `ws://127.0.0.1:8787/session/${sessionId}/connect?userId=${userId}`;
  console.log('\n✅ Fresh live-test session ready.\n');
  console.log(`  workspace: ${workspaceId}`);
  console.log(`  user:      ${userId}`);
  console.log(`  session:   ${sessionId}\n`);
  console.log('Paste this before `pnpm tauri dev` (PowerShell):\n');
  console.log(`  $env:FALCON_WORKER_WS="${wsUrl}"\n`);
} finally {
  await sql.end();
}
