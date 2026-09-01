import Link from 'next/link';
import { searchDecisions, listQueue } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';
import { QueueList } from './QueueList';

export const runtime = 'nodejs';

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getActiveSession();
  if (!session) return null;

  const { q } = await searchParams;
  const [results, queue] = await Promise.all([
    q ? searchDecisions(deps(), session.workspaceId, q) : Promise.resolve([]),
    listQueue(deps(), session.workspaceId),
  ]);

  return (
    <main>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-medium text-ink">Decision Memory</h1>
        <Link href="/decisions/new" className="rounded bg-ink px-3 py-1.5 text-sm text-white">Log a decision</Link>
      </div>

      <form className="mb-6" action="/decisions" method="get">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Ask the org’s confirmed decisions…"
          className="w-full rounded border border-hairline p-2 text-sm text-ink"
        />
      </form>

      {q && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-medium text-muted">Results for “{q}”</h2>
          {results.length === 0 ? (
            <p className="text-muted">No confirmed decisions match “{q}”.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {results.map((r) => (
                <li key={r.id} className="py-3">
                  <Link href={`/decisions/${r.id}`} className="text-ink underline decoration-dotted">{r.title}</Link>
                  {r.decision && <div className="text-sm text-body">{r.decision}</div>}
                  {r.freshnessFlag && <div className="text-xs text-brass">⚠ older than the freshness horizon</div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">Awaiting confirmation ({queue.length})</h2>
        <QueueList items={queue} />
      </section>
    </main>
  );
}
