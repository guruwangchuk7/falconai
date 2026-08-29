'use client';
import { useState } from 'react';

interface Citation { artifactId: string; externalRef: string; title: string | null; type: string }
interface Claim { text: string; citations: Citation[] }
interface AskResponse {
  answerId?: string;
  status: 'grounded' | 'no_grounded_answer';
  claims: Claim[];
  dataAsOf: string | null;
  message?: string;
  conversationId?: string;
}

export function FalconPanel() {
  const [mode, setMode] = useState<'ask' | 'summary'>('ask');
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [state, setState] = useState<'idle' | 'asking' | 'error'>('idle');
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [editState, setEditState] = useState<'idle' | 'saved'>('idle');

  async function submit() {
    if (!input.trim()) return;
    setState('asking'); setAnswer(null); setEditing(false); setEditState('idle');
    try {
      const url = mode === 'ask' ? '/api/falcon/ask' : '/api/falcon/summary';
      const payload = mode === 'ask' ? { question: input, conversationId } : { topic: input, conversationId };
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { setState('error'); return; }
      const data = (await res.json()) as AskResponse;
      setAnswer(data);
      if (data.conversationId) setConversationId(data.conversationId);
      setState('idle');
    } catch { setState('error'); }
  }

  async function saveEdit() {
    if (!answer?.answerId) return;
    await fetch(`/api/falcon/answers/${answer.answerId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ editedText: editText }),
    });
    setEditing(false); setEditState('saved');
  }

  return (
    <div>
      <div className="mb-3 flex gap-3 text-sm">
        <button onClick={() => setMode('ask')} className={mode === 'ask' ? 'font-medium text-ink' : 'text-muted'}>Ask a question</button>
        <button onClick={() => setMode('summary')} className={mode === 'summary' ? 'font-medium text-ink' : 'text-muted'}>Summarize a topic</button>
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={mode === 'ask' ? 'e.g. what did I do for authentication?' : 'e.g. authentication'}
          className="flex-1 rounded border border-hairline p-2.5 text-sm text-ink"
        />
        <button onClick={submit} disabled={state === 'asking'} className="rounded bg-ink px-4 py-2 text-sm text-white disabled:opacity-50">
          {state === 'asking' ? 'Thinking…' : mode === 'ask' ? 'Ask' : 'Summarize'}
        </button>
      </div>

      {state === 'error' && <p className="mt-4 text-sm text-muted">Falcon is temporarily unavailable — try again in a moment.</p>}
      {answer?.status === 'no_grounded_answer' && (
        <p className="mt-4 text-sm text-muted">{answer.message ?? "I don't have anything in your synced work that answers this."}</p>
      )}

      {answer?.status === 'grounded' && (
        <div className="mt-4 space-y-3">
          {answer.claims.map((c, i) => (
            <div key={i} className="rounded border border-hairline p-3">
              <p className="text-sm text-ink">{c.text}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {c.citations.map((cit, j) => (
                  <span key={j} className="rounded bg-hairline/40 px-1.5 py-0.5 text-xs text-muted" title={cit.title ?? ''}>
                    {cit.type} {cit.externalRef}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {answer.dataAsOf && <p className="text-xs text-muted">Based on your work synced as of {new Date(answer.dataAsOf).toLocaleString()}.</p>}

          {!editing && (
            <button
              onClick={() => { setEditing(true); setEditText(answer.claims.map((c) => c.text).join(' ')); }}
              className="text-xs text-muted underline"
            >
              Not quite right? Edit this
            </button>
          )}
          {editing && (
            <div>
              <textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="h-32 w-full rounded border border-hairline p-2 text-sm text-ink" />
              <button onClick={saveEdit} className="mt-2 rounded bg-ink px-3 py-1.5 text-sm text-white">Save my version</button>
            </div>
          )}
          {editState === 'saved' && <p className="text-xs text-muted">Saved — your version is now what Falcon uses.</p>}
        </div>
      )}
    </div>
  );
}
