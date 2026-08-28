import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

// Transaction-mode pooler (Supabase Supavisor) → prepared statements must be off.
const client = postgres(url, { prepare: false });

export const rootDb = drizzle(client, { schema });
export type Db = PostgresJsDatabase<typeof schema>;
export type TenantTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The ONLY sanctioned path to tenant-scoped data (PRD §12.9 / R25, constitution III).
 *
 * Opens a transaction, sets `app.workspace_id` via set_config (parameterized → injection-safe,
 * `is_local = true` → scoped to this transaction), then ASSERTS the setting stuck before running
 * `fn`. The assertion is the guard against session-mode pooling silently reusing a prior
 * request's tenant context: if the value didn't take, we refuse to run rather than risk a leak.
 *
 * RLS policies are fail-closed: with no context set the predicate is `= NULL`, returning zero
 * rows. This helper is what makes the happy path work; RLS is what makes a bug safe.
 */
export async function withTenant<T>(
  workspaceId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return rootDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    const rows = (await tx.execute(
      sql`select current_setting('app.workspace_id', true) as ws`,
    )) as unknown as Array<{ ws: string | null }>;
    if (rows[0]?.ws !== workspaceId) {
      throw new Error(
        'Tenant context was not set for this transaction — refusing to run a tenant query. ' +
          'Verify the DATABASE_URL uses TRANSACTION-mode pooling (not session mode).',
      );
    }
    return fn(tx);
  });
}
