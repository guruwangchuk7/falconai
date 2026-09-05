import Link from 'next/link';
import { searchDecisions, listQueue, listConfirmed, getMeeting } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';
import { QueueList } from './QueueList';
import { AutoRefresh } from './AutoRefresh';

export const runtime = 'nodejs';

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ q?: string; meetingId?: string }> }) {
  const session = await getActiveSession();
  if (!session) return null;

  const { q, meetingId } = await searchParams;
  const meetingSourceRef = meetingId ? `meeting:${meetingId}` : undefined;
  // Browse the confirmed Decision Memory only in the default view (not while searching or scoped to a
  // meeting) — searching already surfaces confirmed matches, and the meeting view is queue-scoped.
  const showConfirmed = !q && !meetingId;
  const [results, queue, meeting, confirmed] = await Promise.all([
    q ? searchDecisions(deps(), session.workspaceId, q, 10, 180, undefined, session.userId) : Promise.resolve([]),
    listQueue(deps(), session.workspaceId, 100, meetingSourceRef, session.userId),
    meetingId ? getMeeting(deps(), session.workspaceId, meetingId) : Promise.resolve(null),
    showConfirmed ? listConfirmed(deps(), session.workspaceId, 100, session.userId) : Promise.resolve([]),
  ]);
  const reviewer = meeting?.attendees.find((a) => a.userId === meeting.designatedReviewerUserId)?.displayName ?? null;

  return (
    <main>
      <AutoRefresh />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-[24px] font-medium text-ink">Decision Memory</h1>
        <Link href="/decisions/new" className="rounded bg-ink px-3 py-1.5 text-sm text-white">Log a decision</Link>
      </div>

      {meeting && (
        <div className="mb-6 rounded border border-hairline bg-hairline/30 p-3 text-sm">
          <span className="text-ink"><strong>{queue.length}</strong> decision{queue.length === 1 ? '' : 's'} captured from {meeting.title ?? 'a meeting'}</span>
          {reviewer && <span className="text-muted"> · {reviewer} to review</span>}
          <Link href="/decisions" className="ml-2 text-xs text-muted underline">show all</Link>
        </div>
      )}

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

      {showConfirmed && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-medium text-muted">Confirmed decisions ({confirmed.length})</h2>
          {confirmed.length === 0 ? (
            <p className="text-sm text-muted">No confirmed decisions yet — confirm one above to add it to Decision Memory.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {confirmed.map((c) => (
                <li key={c.id} className="py-3">
                  <div className="flex items-center gap-2">
                    <Link href={`/decisions/${c.id}`} className="text-ink underline decoration-dotted">{c.title}</Link>
                    {c.sourceRef?.startsWith('meeting:') && (
                      <span className="rounded border border-hairline px-1.5 py-0.5 text-xs text-muted">from meeting</span>
                    )}
                  </div>
                  {c.decision && <div className="truncate text-sm text-body">{c.decision}</div>}
                  {c.confirmedAt && <div className="text-xs text-muted">confirmed {new Date(c.confirmedAt).toLocaleString()}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
