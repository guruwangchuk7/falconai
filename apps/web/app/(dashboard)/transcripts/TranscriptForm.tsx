'use client';
import { useState } from 'react';

/** Transcript-paste capture (C1). Posts to POST /api/transcripts, which parses the text, creates a
 *  meeting + working copy, and enqueues the SAME extract job the live mic path uses. Decisions surface
 *  in /decisions as unconfirmed, cited drafts — this form just hands off and points at the queue. */
interface Result { utteranceCount: number; queueLink: string }

export function TranscriptForm() {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function submit() {
    if (!text.trim()) return;
    setState('submitting'); setResult(null); setErrorMsg(null);
    try {
      const res = await fetch('/api/transcripts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, title: title.trim() || undefined }),
      });
      const data = (await res.json()) as { error?: string; utteranceCount?: number; queueLink?: string };
      if (!res.ok) { setErrorMsg(data.error ?? 'Something went wrong.'); setState('error'); return; }
      setResult({ utteranceCount: data.utteranceCount ?? 0, queueLink: data.queueLink ?? '/decisions?tab=queue' });
      setState('idle'); setText(''); setTitle('');
    } catch {
      setErrorMsg('Falcon is temporarily unavailable — try again in a moment.'); setState('error');
    }
  }

  if (result) {
    return (
      <div className="rounded-2xl border border-hairline bg-surface p-5">
        <p className="text-[15px] font-medium text-ink">Got it — Falcon is reading {result.utteranceCount} lines.</p>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Any decisions it finds will appear in your queue as unconfirmed drafts in a moment, each cited back
          to the transcript. Confirm the ones that are real to make them answerable.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <a href={result.queueLink} className="rounded-full bg-primary px-4 py-2 text-[14px] font-medium text-white transition-colors hover:bg-ink">
            Open the decision queue
          </a>
          <button onClick={() => setResult(null)} className="text-[13.5px] font-medium text-muted underline underline-offset-2 hover:text-ink">
            Add another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional) — e.g. Acme weekly, Sept 5"
        className="w-full rounded-xl border border-hairline-strong bg-surface px-4 py-3 text-[14.5px] text-ink outline-none transition-colors placeholder:text-muted-soft focus:border-ink"
      />
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); if (state === 'error') setState('idle'); }}
        placeholder={"Paste your transcript here.\n\nGuru: Let's keep the original checkout flow.\nSarah: Agreed — remove guest checkout."}
        className="h-72 w-full rounded-2xl border border-hairline-strong bg-surface p-4 text-[14px] leading-relaxed text-ink outline-none transition-colors placeholder:text-muted-soft focus:border-ink"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={submit}
          disabled={state === 'submitting' || !text.trim()}
          className="rounded-full bg-primary px-5 py-2.5 text-[14.5px] font-medium text-white transition-colors hover:bg-ink disabled:opacity-60"
        >
          {state === 'submitting' ? 'Reading…' : 'Extract decisions'}
        </button>
        <span className="text-[13px] text-muted">Text only — never stored as audio. Extraction respects your workspace&apos;s privacy settings.</span>
      </div>
      {state === 'error' && errorMsg && <p className="text-[13.5px] text-brass">{errorMsg}</p>}
    </div>
  );
}
