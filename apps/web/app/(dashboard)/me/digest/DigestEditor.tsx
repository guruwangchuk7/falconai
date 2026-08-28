'use client';
import { useState } from 'react';

export function DigestEditor({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');

  async function save() {
    setState('saving');
    await fetch('/api/me/digest', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    setState('saved');
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setState('idle'); }}
        className="h-64 w-full rounded border border-hairline p-3 text-sm text-ink"
      />
      <div className="mt-2 flex items-center gap-3">
        <button onClick={save} className="rounded bg-ink px-3 py-1.5 text-sm text-white">Save</button>
        {state === 'saving' && <span className="text-sm text-muted">Saving…</span>}
        {state === 'saved' && <span className="text-sm text-muted">Saved — your edit is now what Falcon uses.</span>}
      </div>
    </div>
  );
}
