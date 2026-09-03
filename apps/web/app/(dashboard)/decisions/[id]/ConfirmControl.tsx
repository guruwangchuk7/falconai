'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** The confirm surface for a single unconfirmed record (F10.1 human-in-the-loop write gate). Lets a
 *  human correct/set the owner (mined records carry the artifact author as a hint, per Task 10 —
 *  D6) before ratifying. Confirming is idempotent server-side; this is just the one-click trigger.
 *
 *  Visibility (D13, refined): for a MEETING decision the choice IS the action — two buttons, no
 *  pre-selected default a reviewer can scroll past (the fragile pattern that silently defaults a
 *  client decision to workspace-wide). Every confirm path therefore records an EXPLICIT visibility.
 *  When the meeting had an external (non-member) guest, the attendees-only button leads and a banner
 *  says why — a hint that changes emphasis, never a silent default (detection misses the solo-on-a-
 *  client-call case, so it can only ever *suggest*). Non-meeting records have no tier: one button. */
export function ConfirmControl({
  id,
  ownerUserId,
  isMeeting = false,
  hasExternalAttendee = false,
}: {
  id: string;
  ownerUserId: string | null;
  isMeeting?: boolean;
  hasExternalAttendee?: boolean;
}) {
  const router = useRouter();
  const [owner, setOwner] = useState(ownerUserId ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');

  async function confirm(visibility?: 'workspace' | 'attendees_only') {
    setState('saving');
    const res = await fetch(`/api/decisions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', ownerUserId: owner.trim() || undefined, ...(visibility ? { visibility } : {}) }),
    });
    if (!res.ok) { setState('error'); return; }
    setState('idle');
    router.refresh();
  }

  const busy = state === 'saving';
  const teamBtn = (
    <button key="team" onClick={() => confirm('workspace')} disabled={busy}
      className="rounded border border-hairline px-3 py-1.5 text-xs text-ink hover:bg-hairline/40 disabled:opacity-50">
      {busy ? '…' : 'Confirm for team'}
    </button>
  );
  const attendeesBtn = (
    <button key="attendees" onClick={() => confirm('attendees_only')} disabled={busy}
      className="rounded bg-ink px-3 py-1.5 text-xs text-white disabled:opacity-50">
      {busy ? '…' : 'Confirm — attendees only'}
    </button>
  );

  return (
    <div className="mt-4 rounded border border-hairline p-3">
      <label className="block">
        <span className="text-xs text-muted">{isMeeting ? 'Owner (the meeting hint is often the facilitator — set the real owner)' : 'Owner (correct if the mined hint is wrong)'}</span>
        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="user id"
          className="w-full rounded border border-hairline p-2 text-sm text-ink"
        />
      </label>

      {isMeeting ? (
        <>
          {hasExternalAttendee && (
            <p className="mt-3 text-xs text-brass">
              This meeting had an external guest. Attendees-only is recommended — the verbatim excerpt and
              this decision would otherwise be visible to the whole workspace.
            </p>
          )}
          <div className="mt-3">
            <div className="text-xs text-muted">Who can see this decision? (required — pick one)</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {/* When a guest was present, lead with attendees-only. */}
              {hasExternalAttendee ? [attendeesBtn, teamBtn] : [teamBtn, attendeesBtn]}
            </div>
            {state === 'error' && <span className="mt-2 block text-xs text-brass">Couldn’t confirm — try again.</span>}
          </div>
        </>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => confirm()} disabled={busy} className="rounded bg-ink px-3 py-1.5 text-xs text-white disabled:opacity-50">
            {busy ? '…' : 'Confirm'}
          </button>
          {state === 'error' && <span className="text-xs text-brass">Couldn’t confirm — try again.</span>}
        </div>
      )}
    </div>
  );
}
