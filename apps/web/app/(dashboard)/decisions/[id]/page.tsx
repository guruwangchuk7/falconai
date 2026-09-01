import Link from 'next/link';
import { getDecision } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';
import { ConfirmControl } from './ConfirmControl';

export const runtime = 'nodejs';

const STATUS_LABEL: Record<string, string> = {
  unconfirmed: 'Unconfirmed — not yet answerable',
  confirmed: 'Confirmed',
  superseded: 'Superseded',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-sm text-ink">{children}</div>
    </div>
  );
}

export default async function DecisionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getActiveSession();
  if (!session) return null;
  const { id } = await params;
  const d = await getDecision(deps(), session.workspaceId, id);

  if (!d) {
    return (
      <main className="max-w-2xl">
        <Link href="/decisions" className="text-sm text-muted underline">← Decision Memory</Link>
        <p className="mt-4 text-muted">Decision not found.</p>
      </main>
    );
  }

  const options = Array.isArray(d.options) ? (d.options as unknown[]) : null;
  return (
    <main className="max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/decisions" className="text-sm text-muted underline">← Decision Memory</Link>
        {d.dismissedAt && <span className="text-xs text-brass">dismissed</span>}
      </div>
      <h1 className="text-xl font-medium text-ink">{d.title}</h1>
      <div className="mt-1 text-sm text-body">{STATUS_LABEL[d.status] ?? d.status}</div>
      {d.freshnessFlag && <div className="mt-1 text-xs text-brass">⚠ older than the freshness horizon</div>}

      <div className="mt-4 divide-y divide-hairline">
        {d.decision && <Row label="Decision">{d.decision}</Row>}
        {d.rationale && <Row label="Why">{d.rationale}</Row>}
        {options && options.length > 0 && (
          <Row label="Options considered">
            <ul className="list-inside list-disc">{options.map((o, i) => <li key={i}>{String(o)}</li>)}</ul>
          </Row>
        )}
        {d.dissent && <Row label="Dissent">{d.dissent}</Row>}
        {d.status !== 'unconfirmed' && d.ownerUserId && <Row label="Owner">{d.ownerUserId}</Row>}
        {d.sourceRef && <Row label="Source">{d.sourceRef}</Row>}
        {d.supersedesId && (
          <Row label="Supersedes">
            <Link href={`/decisions/${d.supersedesId}`} className="underline">{d.supersedesTitle ?? d.supersedesId}</Link>
          </Row>
        )}
        {d.supersededById && (
          <Row label="Superseded by">
            <Link href={`/decisions/${d.supersededById}`} className="underline">{d.supersededByTitle ?? d.supersededById}</Link>
          </Row>
        )}
        {d.confirmedAt && <Row label="Confirmed">{new Date(d.confirmedAt).toLocaleString()}{d.confirmedBy ? ` · ${d.confirmedBy}` : ''}</Row>}
        <Row label="Created">{new Date(d.createdAt).toLocaleString()}</Row>
      </div>

      {d.status === 'unconfirmed' && !d.dismissedAt && <ConfirmControl id={d.id} ownerUserId={d.ownerUserId} />}
    </main>
  );
}
