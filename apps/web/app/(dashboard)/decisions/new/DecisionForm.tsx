'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Capture form for a decision (US1). Posts to POST /api/decisions → stored `unconfirmed`; the
 *  record is NOT retrievable until someone confirms it from the queue (F10.1 human-in-the-loop). */
export function DecisionForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [decision, setDecision] = useState('');
  const [rationale, setRationale] = useState('');
  const [options, setOptions] = useState('');
  const [dissent, setDissent] = useState('');
  const [sourceRef, setSourceRef] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');

  async function save() {
    if (!title.trim()) return;
    setState('saving');
    const res = await fetch('/api/decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        decision: decision || undefined,
        rationale: rationale || undefined,
        options: options ? options.split('\n').map((o) => o.trim()).filter(Boolean) : undefined,
        dissent: dissent || undefined,
        sourceRef: sourceRef || undefined,
      }),
    });
    if (!res.ok) { setState('error'); return; }
    router.push('/decisions?tab=queue');
    router.refresh();
  }

  const field = 'w-full rounded border border-hairline p-2 text-sm text-ink';
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-muted">Title *</span>
        <input value={title} onChange={(e) => { setTitle(e.target.value); setState('idle'); }} placeholder="e.g. Adopt Deepgram as primary STT" className={field} />
      </label>
      <label className="block">
        <span className="text-xs text-muted">Decision</span>
        <input value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="What was decided" className={field} />
      </label>
      <label className="block">
        <span className="text-xs text-muted">Why (rationale)</span>
        <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} className={`${field} h-20`} />
      </label>
      <label className="block">
        <span className="text-xs text-muted">Options considered (one per line)</span>
        <textarea value={options} onChange={(e) => setOptions(e.target.value)} className={`${field} h-16`} />
      </label>
      <label className="block">
        <span className="text-xs text-muted">Dissent</span>
        <input value={dissent} onChange={(e) => setDissent(e.target.value)} className={field} />
      </label>
      <label className="block">
        <span className="text-xs text-muted">Source (link / ref, e.g. #482)</span>
        <input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} className={field} />
      </label>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={state === 'saving' || !title.trim()} className="rounded bg-ink px-4 py-2 text-sm text-white disabled:opacity-50">
          {state === 'saving' ? 'Saving…' : 'Log decision'}
        </button>
        <span className="text-xs text-muted">Saved as unconfirmed — confirm it from the queue to make it answerable.</span>
        {state === 'error' && <span className="text-xs text-brass">Couldn’t save — try again.</span>}
      </div>
    </div>
  );
}
