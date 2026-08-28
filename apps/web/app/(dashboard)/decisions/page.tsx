import { searchDecisions } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getActiveSession();
  if (!session) return null;

  const { q } = await searchParams;
  const results = q ? await searchDecisions(deps(), session.workspaceId, q) : [];

  return (
    <main>
      <h1 className="mb-4 text-xl font-medium text-ink">Decision Index</h1>
      <form className="mb-6" action="/decisions" method="get">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search past decisions…"
          className="w-full rounded border border-hairline p-2 text-sm text-ink"
        />
      </form>
      {!q ? (
        <p className="text-muted">Search the org’s confirmed decisions.</p>
      ) : results.length === 0 ? (
        <p className="text-muted">No confirmed decisions match “{q}”.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {results.map((r) => (
            <li key={r.id} className="py-3">
              <div className="text-ink">{r.title}</div>
              {r.decision && <div className="text-sm text-body">{r.decision}</div>}
              {r.freshnessFlag && <div className="text-xs text-brass">⚠ older than the freshness horizon</div>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
