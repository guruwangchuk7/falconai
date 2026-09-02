'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** The confirm surface for a single unconfirmed record (F10.1 human-in-the-loop write gate). Lets a
 *  human correct/set the owner (mined records carry the artifact author as a hint, per Task 10 —
 *  D6) before ratifying. Confirming is idempotent server-side; this is just the one-click trigger. */
export function ConfirmControl({ id, ownerUserId, isMeeting = false }: { id: string; ownerUserId: string | null; isMeeting?: boolean }) {
  const router = useRouter();
  const [owner, setOwner] = useState(ownerUserId ?? '');
  const [visibility, setVisibility] = useState<'workspace' | 'attendees_only'>('workspace');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');

  async function confirm() {
    setState('saving');
    const res = await fetch(`/api/decisions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', ownerUserId: owner.trim() || undefined, ...(isMeeting ? { visibility } : {}) }),
    });
    if (!res.ok) { setState('error'); return; }
    setState('idle');
    router.refresh();
  }

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
      {isMeeting && (
        <fieldset className="mt-3">
          <legend className="text-xs text-muted">Who can see this decision?</legend>
          <label className="mt-1 flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="visibility" checked={visibility === 'workspace'} onChange={() => setVisibility('workspace')} />
            Everyone in the workspace
          </label>
          <label className="mt-1 flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="visibility" checked={visibility === 'attendees_only'} onChange={() => setVisibility('attendees_only')} />
            Only this meeting’s attendees
          </label>
          {visibility === 'attendees_only' && (
            <p className="mt-1 text-xs text-brass">Only attendees will see this decision and its verbatim excerpt. The summary you confirm will not reach the rest of the workspace.</p>
          )}
        </fieldset>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button onClick={confirm} disabled={state === 'saving'} className="rounded bg-ink px-3 py-1.5 text-xs text-white disabled:opacity-50">
          {state === 'saving' ? '…' : 'Confirm'}
        </button>
        {state === 'error' && <span className="text-xs text-brass">Couldn’t confirm — try again.</span>}
      </div>
    </div>
  );
}
