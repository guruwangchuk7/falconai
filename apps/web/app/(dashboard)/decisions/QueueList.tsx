'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export interface QueueItemView {
  id: string;
  title: string;
  decision: string | null;
  rationale: string | null;
  sourceRef: string | null;
  origin: string;
  createdAt: string;
}

/** The unconfirmed queue (US1). Confirming ratifies a record (one click) — the human-in-the-loop
 *  write gate that makes it retrievable (F10.1/F10.4). Content IS shown here: this is the review
 *  surface, not an answer (the never-as-evidence boundary applies to answers). */
export function QueueList({ items }: { items: QueueItemView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: 'confirm' | 'dismiss') {
    setBusy(id);
    await fetch(`/api/decisions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    router.refresh();
  }

  if (items.length === 0) return <p className="text-sm text-muted">Nothing awaiting confirmation.</p>;
  return (
    <ul className="divide-y divide-hairline">
      {items.map((it) => (
        <li key={it.id} className="flex items-start justify-between gap-3 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link href={`/decisions/${it.id}`} className="text-ink underline decoration-dotted">{it.title}</Link>
              {it.origin === 'suggested' && it.sourceRef && (
                <span className="rounded border border-hairline px-1.5 py-0.5 text-xs text-muted">Suggested from {it.sourceRef}</span>
              )}
            </div>
            {it.decision && <div className="truncate text-sm text-body">{it.decision}</div>}
            {it.sourceRef && <div className="text-xs text-muted">source: {it.sourceRef}</div>}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => act(it.id, 'confirm')}
              disabled={busy === it.id}
              className="rounded bg-ink px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {busy === it.id ? '…' : 'Confirm'}
            </button>
            <button
              onClick={() => act(it.id, 'dismiss')}
              disabled={busy === it.id}
              className="rounded border border-hairline px-3 py-1.5 text-xs text-muted hover:text-ink disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
