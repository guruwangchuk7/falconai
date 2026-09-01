'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** The confirm surface for a single unconfirmed record (F10.1 human-in-the-loop write gate). Lets a
 *  human correct/set the owner (mined records carry the artifact author as a hint, per Task 10 —
 *  D6) before ratifying. Confirming is idempotent server-side; this is just the one-click trigger. */
export function ConfirmControl({ id, ownerUserId }: { id: string; ownerUserId: string | null }) {
  const router = useRouter();
  const [owner, setOwner] = useState(ownerUserId ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');

  async function confirm() {
    setState('saving');
    const res = await fetch(`/api/decisions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', ownerUserId: owner.trim() || undefined }),
    });
    if (!res.ok) { setState('error'); return; }
    setState('idle');
    router.refresh();
  }

  return (
    <div className="mt-4 rounded border border-hairline p-3">
      <label className="block">
        <span className="text-xs text-muted">Owner (correct if the mined hint is wrong)</span>
        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="user id"
          className="w-full rounded border border-hairline p-2 text-sm text-ink"
        />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={confirm} disabled={state === 'saving'} className="rounded bg-ink px-3 py-1.5 text-xs text-white disabled:opacity-50">
          {state === 'saving' ? '…' : 'Confirm'}
        </button>
        {state === 'error' && <span className="text-xs text-brass">Couldn’t confirm — try again.</span>}
      </div>
    </div>
  );
}
