import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(HERE, '../../packages/db/drizzle/0001_init.sql');

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
