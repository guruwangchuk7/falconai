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
