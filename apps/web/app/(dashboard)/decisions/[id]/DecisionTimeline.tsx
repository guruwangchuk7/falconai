import Link from 'next/link';
import type { TimelineNode } from '@falcon/core';

/** Vertical supersession timeline, oldest -> current. Renders masked hops as honest, contentless
 *  placeholders. Server component (no client state). */
export function DecisionTimeline({ nodes }: { nodes: TimelineNode[] }) {
  return (
    <div className="mt-6">
      <div className="text-xs uppercase tracking-wide text-muted">How this decision evolved</div>
      <ol className="mt-3 border-l border-hairline">
        {nodes.map((n, i) => (
          <li key={n.restricted ? `m${i}` : n.id} className="relative pl-5 pb-5 last:pb-0">
            <span
              className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${
                n.restricted ? 'bg-hairline' : n.isCurrent ? 'bg-forest' : 'bg-muted-soft'
              }`}
            />
            {n.restricted ? (
              <div className="text-sm text-muted">A version you don’t have access to</div>
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {n.isViewed ? (
                    <span className="text-sm font-medium text-ink">{n.title}</span>
                  ) : (
                    <Link href={`/decisions/${n.id}`} className="text-sm font-medium text-ink underline decoration-dotted">
                      {n.title}
                    </Link>
                  )}
                  {n.isCurrent ? (
                    <span className="rounded-full bg-forest/10 px-2 py-0.5 text-[11px] font-medium text-forest">current</span>
                  ) : (
                    <span className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-muted">superseded</span>
                  )}
                  {n.isViewed && <span className="text-[11px] text-muted-soft">you are here</span>}
                </div>
                {n.decision && <div className="mt-0.5 text-sm text-body">{n.decision}</div>}
                {n.rationale && <div className="mt-0.5 text-[13px] text-muted">why: {n.rationale}</div>}
                <div className="mt-0.5 text-[12px] text-muted-soft">
                  {n.date ? new Date(n.date).toLocaleDateString() : 'date unknown'}
                  {n.confirmedByName ? ` · ${n.confirmedByName}` : ''}
                  {` · from ${n.origin === 'meeting' ? 'a meeting' : n.origin === 'suggested' ? 'a synced source' : 'a person'}`}
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
