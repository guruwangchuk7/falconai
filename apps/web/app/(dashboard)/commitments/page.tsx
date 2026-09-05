import Link from 'next/link';
import { listCommitments } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';
import { CommitmentList } from './CommitmentList';

export const runtime = 'nodejs';

type Show = 'open' | 'done' | 'all';

const FILTERS: { key: Show; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
];

/**
 * Commitments — the "what did I promise, and to whom, that isn't done yet?" surface. Falcon pulls
 * commitments out of the same pasted transcripts it mines for decisions; each one carries the verbatim
 * line it came from (the receipt). Grouped by counterparty so "what did I promise Acme" reads at a glance.
 */
export default async function CommitmentsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const s = await getActiveSession();
  const sp = await searchParams;
  const show: Show = sp.show === 'done' || sp.show === 'all' ? sp.show : 'open';

  const rows = s
    ? await listCommitments(deps(), s.workspaceId, show === 'all' ? {} : { status: show }).catch(() => [])
    : [];

  return (
    <main>
      <h1 className="font-display text-[32px] font-medium leading-tight tracking-[-0.2px] text-ink">Commitments</h1>
      <p className="mt-3 max-w-2xl text-[15px] text-muted">
        The promises Falcon caught — who owes what, to whom, with the exact line it came from. Paste a call
        or meeting transcript and open commitments show up here automatically. Mark them done as they land.
      </p>

      <div className="mt-6 flex items-center gap-1.5">
        {FILTERS.map((f) => {
          const active = f.key === show;
          return (
            <Link
              key={f.key}
              href={f.key === 'open' ? '/commitments' : `/commitments?show=${f.key}`}
              aria-current={active ? 'true' : undefined}
              className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
                active ? 'bg-ink text-white' : 'border border-hairline text-muted hover:text-ink'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6 max-w-2xl">
        <CommitmentList items={rows} show={show} />
      </div>
    </main>
  );
}
