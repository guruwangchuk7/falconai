'use client';
import { useState } from 'react';

interface Citation { artifactId: string; externalRef: string; title: string | null; type: string }
interface Claim { text: string; citations: Citation[] }
interface AskResponse {
  status: 'grounded' | 'no_grounded_answer';
  claims: Claim[];
  dataAsOf: string | null;
  message?: string;
  conversationId?: string;
}

export function FalconPanel() {
  const [question, setQuestion] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [state, setState] = useState<'idle' | 'asking' | 'error'>('idle');

  async function ask() {
    if (!question.trim()) return;
    setState('asking');
    setAnswer(null);
    try {
      const res = await fetch('/api/falcon/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, conversationId }),
      });
      if (!res.ok) { setState('error'); return; }
      const data = (await res.json()) as AskResponse;
      setAnswer(data);
      if (data.conversationId) setConversationId(data.conversationId);
      setState('idle');
    } catch {
      setState('error');
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
          placeholder="Ask about your work — e.g. what did I do for authentication?"
          className="flex-1 rounded border border-hairline p-2.5 text-sm text-ink"
        />
        <button onClick={ask} disabled={state === 'asking'} className="rounded bg-ink px-4 py-2 text-sm text-white disabled:opacity-50">
          {state === 'asking' ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {state === 'error' && (
        <p className="mt-4 text-sm text-muted">Falcon is temporarily unavailable — try again in a moment.</p>
      )}

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
          {answer.dataAsOf && (
            <p className="text-xs text-muted">Based on your work synced as of {new Date(answer.dataAsOf).toLocaleString()}.</p>
          )}
        </div>
      )}
    </div>
  );
}
