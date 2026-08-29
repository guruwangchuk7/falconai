import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;
export type TenantTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  client: Sql;
  rootDb: Db;
  withTenant<T>(workspaceId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
}

/**
 * Build a DB handle for a connection URL. Injectable so tests can point at a container
 * (and so the app can use the transaction-mode pooler URL). `prepare: false` is required for
 * transaction-mode pooling.
 *
 * `withTenant` is the ONLY sanctioned path to tenant data (PRD §12.9/R25, constitution III):
 * it opens a transaction, sets `app.workspace_id` via set_config (parameterized → injection-safe,
 * txn-local), and ASSERTS it stuck before running `fn` — the guard against session-mode pooling
 * silently reusing a prior request's tenant context. RLS is fail-closed (missing setting → NULL
 * → zero rows); this helper makes the happy path work, RLS makes a bug safe.
 *
 * IMPORTANT: the connection must use a NON-SUPERUSER role. Postgres superusers bypass RLS even
 * with FORCE ROW LEVEL SECURITY, so a superuser connection would silently defeat isolation.
 */
export function createDb(url: string): DbHandle {
  const client = postgres(url, { prepare: false });
  const rootDb = drizzle(client, { schema });

  async function withTenant<T>(workspaceId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return rootDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
      const rows = (await tx.execute(
        sql`select current_setting('app.workspace_id', true) as ws`,
      )) as unknown as Array<{ ws: string | null }>;
      if (rows[0]?.ws !== workspaceId) {
        throw new Error(
          'Tenant context was not set for this transaction — refusing to run a tenant query. ' +
            'Verify DATABASE_URL uses TRANSACTION-mode pooling (not session mode).',
        );
      }
      return fn(tx);
    });
  }

  return { client, rootDb, withTenant };
}

let _default: DbHandle | undefined;

/**
 * Lazy singleton for the app runtime. Prefers `APP_DATABASE_URL` (a NON-SUPERUSER, non-BYPASSRLS
 * role — e.g. `falcon_app` — so RLS actually enforces per R25/SC-003) and falls back to
 * `DATABASE_URL`. Migrations run separately as the owner via `DATABASE_URL`; only the runtime
 * should use the restricted role. On managed Postgres (e.g. Supabase) the default `postgres` role
 * has BYPASSRLS, which silently defeats tenant isolation — set `APP_DATABASE_URL` in production.
 * Tests use `createDb(containerUrl)` with a purpose-built `falcon_app` role instead.
 */
export function getDb(): DbHandle {
  if (!_default) {
    const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error('APP_DATABASE_URL or DATABASE_URL is required');
    _default = createDb(url);
  }
  return _default;
}
