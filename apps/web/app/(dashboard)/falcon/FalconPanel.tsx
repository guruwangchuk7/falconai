'use client';
import { useState } from 'react';

interface Citation { artifactId?: string; externalRef: string; title: string | null; type: string; url: string | null }
interface Claim { text: string; citations: Citation[] }
interface PendingRef { count: number; sourceRefs: (string | null)[]; queueLink: string }
interface DecisionStatus {
  settled?: { decisionId: string; changed: boolean };
  pendingChange?: PendingRef;
  proposed?: PendingRef;
}
interface AskResponse {
  answerId?: string;
  status: 'grounded' | 'no_grounded_answer';
  claims: Claim[];
  dataAsOf: string | null;
  decisionStatus?: DecisionStatus;
  message?: string;
  conversationId?: string;
}

/** The four-state decision boundary (US2). Surfaces an UNCONFIRMED candidate as a neutral status line
 *  — existence + source pointer + a link to the queue — and NEVER its content. */
function DecisionStatusNote({ status }: { status: DecisionStatus }) {
  const pending = status.proposed ?? status.pendingChange;
  if (!pending) return null;
  const refs = pending.sourceRefs.filter((r): r is string => !!r);
  const from = refs.length ? ` (from ${refs.join(', ')})` : '';
  const lead = status.proposed
    ? "This isn't settled yet — there's an unconfirmed decision candidate"
    : 'Heads up: an unratified change to this decision has been proposed';
  const plural = pending.count > 1 ? `${pending.count} candidates` : 'a candidate';
  return (
    <p className="mt-3 rounded border border-hairline bg-hairline/20 p-2.5 text-sm text-body">
      {lead}{pending.count > 1 ? ` — ${plural}` : ''}{from}.{' '}
      <a href={pending.queueLink} className="underline decoration-dotted hover:text-ink">Open the decision queue</a>
    </p>
  );
}

interface ConvSummary { id: string; title: string | null; updatedAt: string }
interface HistoryTurn {
  questionText: string;
  kind: string;
  status: string;
  text: string | null;
  edited: boolean;
  dataAsOf: string | null;
  citations: Citation[];
}
interface HistoryDetail { id: string; title: string | null; turns: HistoryTurn[] }

/** Citation chips — a link when the source resolves to a URL, a plain label otherwise. Shared by
 *  the live answer and the history view. */
function CitationChips({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {citations.map((cit, j) =>
        cit.url ? (
          <a
            key={j}
            href={cit.url}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-hairline/40 px-1.5 py-0.5 text-xs text-muted underline decoration-dotted hover:text-ink"
            title={cit.title ?? 'Open source'}
          >
            {cit.type} {cit.externalRef}
          </a>
        ) : (
          <span key={j} className="rounded bg-hairline/40 px-1.5 py-0.5 text-xs text-muted" title={cit.title ?? ''}>
            {cit.type} {cit.externalRef}
          </span>
        ),
      )}
    </div>
  );
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

  // History
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [historyDetail, setHistoryDetail] = useState<HistoryDetail | null>(null);

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

  async function openHistory() {
    setShowHistory(true); setHistoryDetail(null);
    const res = await fetch('/api/falcon/conversations');
    if (res.ok) setConversations((await res.json()) as ConvSummary[]);
  }
  async function openConversation(id: string) {
    const res = await fetch(`/api/falcon/conversations/${id}`);
    if (res.ok) setHistoryDetail((await res.json()) as HistoryDetail);
  }

  if (showHistory) {
    return (
      <div>
        <div className="mb-3 flex items-center gap-3 text-sm">
          <button onClick={() => { setShowHistory(false); setHistoryDetail(null); }} className="text-muted underline">← Back to asking</button>
          {historyDetail && (
            <button onClick={() => setHistoryDetail(null)} className="text-muted underline">All conversations</button>
          )}
        </div>

        {!historyDetail && (
          <div className="space-y-1.5">
            {conversations.length === 0 && <p className="text-sm text-muted">No past conversations yet.</p>}
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className="block w-full rounded border border-hairline p-2.5 text-left text-sm text-ink hover:bg-hairline/20"
              >
                <span>{c.title ?? 'Untitled'}</span>
                <span className="ml-2 text-xs text-muted">{new Date(c.updatedAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}

        {historyDetail && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-ink">{historyDetail.title ?? 'Conversation'}</h2>
            {historyDetail.turns.map((t, i) => (
              <div key={i} className="rounded border border-hairline p-3">
                <p className="text-xs font-medium text-muted">You asked{t.kind === 'summary' ? ' (summary)' : ''}:</p>
                <p className="mb-2 text-sm text-ink">{t.questionText}</p>
                {t.status === 'no_grounded_answer' ? (
                  <p className="text-sm text-muted">No grounded answer.</p>
                ) : (
                  <>
                    <p className="text-sm text-ink">{t.text}</p>
                    <CitationChips citations={t.citations} />
                    {t.edited && <p className="mt-1 text-xs text-muted">(your edited version)</p>}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3 text-sm">
        <button onClick={() => setMode('ask')} className={mode === 'ask' ? 'font-medium text-ink' : 'text-muted'}>Ask a question</button>
        <button onClick={() => setMode('summary')} className={mode === 'summary' ? 'font-medium text-ink' : 'text-muted'}>Summarize a topic</button>
        <button onClick={openHistory} className="ml-auto text-muted underline">History</button>
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
              <CitationChips citations={c.citations} />
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

      {answer?.decisionStatus && <DecisionStatusNote status={answer.decisionStatus} />}
    </div>
  );
}
