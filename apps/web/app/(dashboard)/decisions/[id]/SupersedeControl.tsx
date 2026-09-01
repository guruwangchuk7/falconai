'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Mark THIS confirmed decision as superseding an earlier confirmed one (US3). The older decision is
 *  flipped to `superseded` and stops grounding answers — a reversed decision never reads as live. */
export function SupersedeControl({ id, candidates }: { id: string; candidates: { id: string; title: string }[] }) {
  const router = useRouter();
  const [target, setTarget] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');

  if (candidates.length === 0) {
    return <p className="text-xs text-muted">No other confirmed decisions to supersede yet.</p>;
  }

  async function supersede() {
    if (!target) return;
    setState('saving');
    const res = await fetch(`/api/decisions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'supersede', supersedesId: target }),
    });
    if (!res.ok) { setState('error'); return; }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">This decision replaces:</span>
      <select
        value={target}
        onChange={(e) => { setTarget(e.target.value); setState('idle'); }}
        className="rounded border border-hairline p-1.5 text-sm text-ink"
      >
        <option value="">Select an earlier decision…</option>
        {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>
      <button
        onClick={supersede}
        disabled={!target || state === 'saving'}
        className="rounded bg-ink px-3 py-1.5 text-xs text-white disabled:opacity-50"
      >
        {state === 'saving' ? 'Superseding…' : 'Supersede'}
      </button>
      {state === 'error' && <span className="text-xs text-brass">Couldn’t supersede — try again.</span>}
    </div>
  );
}
