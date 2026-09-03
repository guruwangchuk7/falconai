import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(HERE, '../../packages/db/drizzle/0001_init.sql');
// 0004 adds decision_record.dismissed_at, which the SHARED answer path (answerQuestion →
// matchUnconfirmedCandidates) now reads. Applied in the base so every test DB has it — it is an
// idempotent `ADD COLUMN IF NOT EXISTS`, so tests that also apply it explicitly still work.
const MIGRATION_DISMISSED = resolve(HERE, '../../packages/db/drizzle/0004_decision_dismissed_at.sql');
// 0005 (Ship 2 / Decision Miner) adds artifact.state/merged_closed_at, decision_record.origin,
// connection.mine_watermark, and the mined_artifact ledger (with its own RLS policy). Applied in
// the base — like 0004 — so every test DB has it; idempotent `ADD COLUMN IF NOT EXISTS` / `CREATE
// TABLE IF NOT EXISTS`, so tests that also apply it explicitly still work.
const MIGRATION_MINER = resolve(HERE, '../../packages/db/drizzle/0005_decision_miner.sql');
// 0006 (In-Meeting Decision Listener) adds meeting/meeting_transcript/decision_span/mined_meeting
// (each with its own RLS policy), plus decision_record.visibility/participants and
// workspace.meeting_retention_days. Applied in the base — like 0004/0005 — so every test DB has it;
// idempotent `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`.
const MIGRATION_LISTENER = resolve(HERE, '../../packages/db/drizzle/0006_in_meeting_listener.sql');
// 0007 (In-Meeting Decision Listener, Task B3) adds the SECURITY DEFINER session->workspace
// resolver the session-worker uses to bootstrap its tenant context before `session` is readable
// under RLS. Its body is `plpgsql` (not `sql`), so it is NOT validated against the catalog at
// CREATE FUNCTION time — safe to apply here, before 0003 (which creates `session`) even exists in
// this base. Applied in the base — like 0004/0005/0006 — so every test DB has it.
const MIGRATION_RESOLVER = resolve(HERE, '../../packages/db/drizzle/0007_session_workspace_resolver.sql');
// 0008 (In-Meeting Decision Listener, Task D1) adds the RESTRICTIVE attendee-gate policy on
// decision_span (ANDs with 0006's tenant policy): a SELECT returns a span only if app.user_id is
// set AND that user is in the parent decision_record's participants snapshot. FOR SELECT only, so
// it does not affect the write path. Applied in the base — like 0004/0005/0006/0007 — so every
// test DB has it.
const MIGRATION_SPAN_ACL = resolve(HERE, '../../packages/db/drizzle/0008_decision_span_attendee_acl.sql');
// 0009 (In-Meeting Decision Listener, D7 robustness) adds a unique index on meeting(workspace_id,
// session_id) — a backstop against a concurrent double-trigger / failover creating two meetings for
// one session. `meeting` exists in the base test set via 0006, so a plain unique index is safe here.
// Applied in the base — like 0004/0005/0006/0007/0008 — so every test DB has it.
const MIGRATION_MEETING_SESSION_UNIQ = resolve(HERE, '../../packages/db/drizzle/0009_meeting_session_unique.sql');
// 0010 (D13 refinement) makes decision_record.visibility NULLABLE so "nobody has chosen a tier yet"
// (how a meeting decision is created) is representable, distinct from a chosen 'workspace'. Applied in
// the base — like 0004..0009 — so every test DB has it.
const MIGRATION_VIS_NULLABLE = resolve(HERE, '../../packages/db/drizzle/0010_decision_visibility_nullable.sql');

export interface TestDb {
  container: StartedPostgreSqlContainer;
  adminUrl: string; // superuser — seeding bypasses RLS
  appUrl: string;   // non-superuser falcon_app — RLS ENFORCES (superusers bypass it)
  admin: Sql;       // open admin connection for seeding
  stop(): Promise<void>;
}

/**
 * Boots a pgvector Postgres, applies the real 0001_init.sql, and creates a NON-SUPERUSER
 * `falcon_app` role. The app/withTenant path must connect as falcon_app or RLS is silently
 * bypassed (superusers ignore RLS even under FORCE). Requires a Docker host.
 */
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('falcon_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const adminUrl = container.getConnectionUri();
  const admin = postgres(adminUrl, { prepare: false });

  await admin.unsafe(readFileSync(MIGRATION, 'utf8'));
  await admin.unsafe(readFileSync(MIGRATION_DISMISSED, 'utf8'));
  await admin.unsafe(readFileSync(MIGRATION_MINER, 'utf8'));
  await admin.unsafe(readFileSync(MIGRATION_LISTENER, 'utf8'));
  await admin.unsafe(readFileSync(MIGRATION_RESOLVER, 'utf8'));
  await admin.unsafe(readFileSync(MIGRATION_SPAN_ACL, 'utf8'));
  await admin.unsafe(readFileSync(MIGRATION_MEETING_SESSION_UNIQ, 'utf8'));
  await admin.unsafe(readFileSync(MIGRATION_VIS_NULLABLE, 'utf8'));
  await admin.unsafe(`
    create role falcon_app login password 'app';
    grant usage on schema public to falcon_app;
    grant select, insert, update, delete on all tables in schema public to falcon_app;
  `);

  const appUrl = adminUrl.replace('postgres:postgres@', 'falcon_app:app@');
  return {
    container,
    adminUrl,
    appUrl,
    admin,
    async stop() {
      await admin.end();
      await container.stop();
    },
  };
}
