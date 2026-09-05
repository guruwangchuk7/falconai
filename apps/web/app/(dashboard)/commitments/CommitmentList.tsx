'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface CommitmentView {
  id: string;
  text: string;
  ownerHint: string | null;
  counterparty: string | null;
  dueHint: string | null;
  status: 'open' | 'done';
  sourceRef: string | null;
  evidenceSpeaker: string | null;
  evidenceText: string;
  createdAt: string;
}

const NO_COUNTERPARTY = 'No client named';

/** Groups commitments under their counterparty ("Acme", "Internal", …) so the killer question — "what
 *  did I promise Acme that isn't done?" — is answered by scanning one section. Preserves input order
 *  (newest-first) within each group and orders groups by first appearance. */
function groupByCounterparty(items: CommitmentView[]): [string, CommitmentView[]][] {
  const groups = new Map<string, CommitmentView[]>();
  for (const it of items) {
    const key = it.counterparty?.trim() || NO_COUNTERPARTY;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(it);
  }
  return [...groups.entries()];
}

export function CommitmentList({ items, show }: { items: CommitmentView[]; show: 'open' | 'done' | 'all' }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(id: string, done: boolean) {
    setBusy(id);
    await fetch(`/api/commitments/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done }),
    });
    setBusy(null);
    router.refresh();
  }

  if (items.length === 0) {
    const msg =
      show === 'done'
        ? 'Nothing marked done yet.'
        : show === 'all'
          ? 'No commitments yet. Paste a call or meeting transcript and Falcon will pull out the promises people made.'
          : 'No open commitments. Everything Falcon caught is either done or you haven’t added a transcript yet.';
    return <p className="text-sm text-muted">{msg}</p>;
  }

  return (
    <div className="flex flex-col gap-7">
      {groupByCounterparty(items).map(([counterparty, group]) => (
        <section key={counterparty}>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-soft">
            {counterparty} <span className="font-medium normal-case tracking-normal text-muted">· {group.length}</span>
          </h2>
          <ul className="divide-y divide-hairline">
            {group.map((it) => (
              <li key={it.id} className="flex items-start justify-between gap-3 py-3.5">
                <div className="min-w-0 max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[15px] ${it.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>{it.text}</span>
                    {it.dueHint && (
                      <span className="rounded-full border border-hairline px-2 py-0.5 text-[12px] text-muted">{it.dueHint}</span>
                    )}
                  </div>
                  {it.ownerHint && <div className="mt-0.5 text-[13px] text-muted">promised by {it.ownerHint}</div>}
                  {/* The receipt — the verbatim line the promise was extracted from (provenance, not a paraphrase). */}
                  <div className="mt-1.5 border-l-2 border-hairline pl-2.5 text-[13px] italic text-muted">
                    “{it.evidenceSpeaker ? `${it.evidenceSpeaker}: ` : ''}{it.evidenceText}”
                    {it.sourceRef && <span className="ml-1 not-italic text-muted-soft">— {it.sourceRef}</span>}
                  </div>
                </div>
                <div className="flex shrink-0">
                  {it.status === 'open' ? (
                    <button
                      onClick={() => toggle(it.id, true)}
                      disabled={busy === it.id}
                      className="rounded bg-ink px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    >
                      {busy === it.id ? '…' : 'Mark done'}
                    </button>
                  ) : (
                    <button
                      onClick={() => toggle(it.id, false)}
                      disabled={busy === it.id}
                      className="rounded border border-hairline px-3 py-1.5 text-xs text-muted hover:text-ink disabled:opacity-50"
                    >
                      {busy === it.id ? '…' : 'Reopen'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
