import { schema } from '@falcon/db';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

export default async function IntegrationsPage() {
  const session = await getActiveSession();
  if (!session) return null;

  const conns = await deps().db.withTenant(session.workspaceId, (tx) => tx.select().from(schema.connection));

  return (
    <main>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-medium text-ink">Integrations</h1>
        <div className="flex gap-2">
          <a href="/api/integrations/github/connect" className="rounded bg-ink px-3 py-1.5 text-sm text-white">
            Connect GitHub
          </a>
          <a href="/api/integrations/linear/connect" className="rounded border border-hairline px-3 py-1.5 text-sm text-ink">
            Connect Linear
          </a>
        </div>
      </div>
      {conns.length === 0 ? (
        <p className="text-muted">No sources connected yet. Connect GitHub or Linear to index your recent work.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {conns.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-3">
              <span className="text-ink">{c.provider}</span>
              <span className="text-sm text-muted">
                {c.status}
                {c.lastSyncedAt ? ` · synced ${new Date(c.lastSyncedAt).toLocaleString()}` : ' · never synced'}
                {c.lastError ? ` · ${c.lastError}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
