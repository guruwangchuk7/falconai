import { schema } from '@falcon/db';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

const ERRORS: Record<string, string> = {
  invalid_state: 'Connection request expired or was invalid — please try again.',
  linear_misconfigured: 'Linear is not fully configured (missing client credentials).',
  jira_fields: 'Jira needs a base URL (https://…), email, and API token.',
  jira_auth: 'Jira rejected those credentials — check the email and API token.',
  rate_limited: 'Too many connection attempts — wait a minute and try again.',
};

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getActiveSession();
  if (!session) return null;

  const { error } = await searchParams;
  const conns = await deps().db.withTenant(session.workspaceId, (tx) => tx.select().from(schema.connection));

  return (
    <main>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-[24px] font-medium text-ink">Integrations</h1>
        <div className="flex gap-2">
          <a href="/api/integrations/github/connect" className="rounded bg-ink px-3 py-1.5 text-sm text-white">
            Connect GitHub
          </a>
          <a href="/api/integrations/linear/connect" className="rounded border border-hairline px-3 py-1.5 text-sm text-ink">
            Connect Linear
          </a>
        </div>
      </div>
      {error ? (
        <p className="mb-4 rounded border border-hairline bg-red-50 px-3 py-2 text-sm text-red-700">
          {ERRORS[error] ?? 'Something went wrong connecting that source.'}
        </p>
      ) : null}
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

      <details className="mt-8 border-t border-hairline pt-4">
        <summary className="cursor-pointer text-sm font-medium text-ink">Connect Jira (API token)</summary>
        <form method="post" action="/api/integrations/jira/connect" className="mt-3 flex max-w-md flex-col gap-2">
          <input name="baseUrl" type="url" required placeholder="https://your-org.atlassian.net"
            className="rounded border border-hairline px-3 py-1.5 text-sm text-ink" />
          <input name="email" type="email" required placeholder="you@company.com"
            className="rounded border border-hairline px-3 py-1.5 text-sm text-ink" />
          <input name="apiToken" type="password" required placeholder="Jira API token"
            className="rounded border border-hairline px-3 py-1.5 text-sm text-ink" />
          <button type="submit" className="self-start rounded bg-ink px-3 py-1.5 text-sm text-white">Connect Jira</button>
          <p className="text-xs text-muted">
            Create a token at id.atlassian.com → Security → API tokens. Stored encrypted in the
            secrets store, never in the app database.
          </p>
        </form>
      </details>
    </main>
  );
}
