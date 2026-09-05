import Link from 'next/link';
import { getDecision, getDecisionSpans, getMeeting, getDecisionTimeline } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';
import { ConfirmControl } from './ConfirmControl';
import { DecisionTimeline } from './DecisionTimeline';

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
  const d = await getDecision(deps(), session.workspaceId, id, session.userId);

  if (!d) {
    return (
      <main>
        <Link href="/decisions" className="text-sm text-muted underline">← Decision Memory</Link>
        <p className="mt-4 text-muted">Decision not found.</p>
      </main>
    );
  }

  const isMeeting = d.origin === 'meeting';
  // sourceRef is only the pointer used to fetch the meeting; whether this IS a meeting decision is the
  // typed `origin`, so the visibility chooser + guard can't drift with a sourceRef string convention.
  const meetingId = isMeeting && d.sourceRef?.startsWith('meeting:') ? d.sourceRef.slice('meeting:'.length) : null;
  const meeting = meetingId ? await getMeeting(deps(), session.workspaceId, meetingId) : null;

  const timeline = await getDecisionTimeline(deps(), session.workspaceId, id, session.userId);
  const spans = await getDecisionSpans(deps(), session.workspaceId, id, session.userId);
  const decisionSpans = spans.filter((s) => s.kind === 'decision');
  const rationaleSpans = spans.filter((s) => s.kind === 'rationale');

  const options = Array.isArray(d.options) ? (d.options as unknown[]) : null;
  return (
    <main>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/decisions" className="text-sm text-muted underline">← Decision Memory</Link>
        {d.dismissedAt && <span className="text-xs text-brass">dismissed</span>}
      </div>
      <h1 className="font-display text-[24px] font-medium text-ink">{d.title}</h1>
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
        {d.sourceRef && (
          <Row label="Source">
            {meeting
              ? <Link href={`/decisions?meetingId=${meetingId}`} className="underline">{meeting.title ?? 'Meeting'}{meeting.endedAt ? ` · ${new Date(meeting.endedAt).toLocaleString()}` : ''}</Link>
              : d.sourceRef}
          </Row>
        )}
        {d.confirmedAt && <Row label="Confirmed">{new Date(d.confirmedAt).toLocaleString()}{d.confirmedBy ? ` · ${d.confirmedBy}` : ''}</Row>}
        <Row label="Created">{new Date(d.createdAt).toLocaleString()}</Row>
      </div>

      {/* Full supersession lineage (replaces the single-hop Supersedes/Superseded-by rows). Only shows
          when the decision actually has a history; a lone decision renders nothing here. */}
      {timeline.length > 1 && <DecisionTimeline nodes={timeline} />}

      {spans.length > 0 && (
        <div className="mt-6">
          <div className="text-xs uppercase tracking-wide text-muted">Meeting excerpt · visible to attendees only</div>
          {decisionSpans.length > 0 && (
            <div className="mt-2">
              <div className="text-xs text-brass">Decision</div>
              {decisionSpans.map((s, i) => (
                <p key={`d${i}`} className="text-sm text-body">{s.speaker ? <span className="text-muted">{s.speaker}: </span> : null}{s.text}</p>
              ))}
            </div>
          )}
          {rationaleSpans.length > 0 && (
            <div className="mt-2">
              <div className="text-xs text-brass">Why</div>
              {rationaleSpans.map((s, i) => (
                <p key={`r${i}`} className="text-sm text-body">{s.speaker ? <span className="text-muted">{s.speaker}: </span> : null}{s.text}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {d.status === 'unconfirmed' && !d.dismissedAt && (
        <ConfirmControl
          id={d.id}
          ownerUserId={d.ownerUserId}
          isMeeting={isMeeting}
          hasExternalAttendee={meeting?.attendees.some((a) => !a.isMember) ?? false}
        />
      )}
    </main>
  );
}
