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
    <p className="mt-3 rounded-xl border border-hairline bg-surface-strong/50 p-3 text-[13.5px] text-body">
      {lead}{pending.count > 1 ? ` — ${plural}` : ''}{from}.{' '}
      <a href={pending.queueLink} className="font-medium underline decoration-dotted underline-offset-2 hover:text-ink">Open the decision queue</a>
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
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {citations.map((cit, j) =>
        cit.url ? (
          <a
            key={j}
            href={cit.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-strong/50 px-2.5 py-1 text-[12px] font-medium text-body transition-colors hover:border-hairline-strong hover:text-ink"
            title={cit.title ?? 'Open source'}
          >
            <CiteDot />
            {cit.type} {cit.externalRef}
          </a>
        ) : (
          <span
            key={j}
            className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-strong/50 px-2.5 py-1 text-[12px] font-medium text-muted"
            title={cit.title ?? ''}
          >
            <CiteDot />
            {cit.type} {cit.externalRef}
          </span>
        ),
      )}
    </div>
  );
}

function CiteDot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-forest" aria-hidden />;
}

// Grounded-in-real-work prompts. Every one queries the user's own synced artifacts — no fabricated
// data, just good entry points into what Falcon actually knows.
const STARTERS = [
  'What did I work on this week?',
  'What did I do for authentication?',
  'Summarize my recent pull requests',
  'What decisions have I made recently?',
];

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

  async function submit(override?: string) {
    const question = (override ?? input).trim();
    if (!question) return;
    if (override) setInput(override);
    setState('asking'); setAnswer(null); setEditing(false); setEditState('idle');
    try {
      const url = mode === 'ask' ? '/api/falcon/ask' : '/api/falcon/summary';
      const payload = mode === 'ask' ? { question, conversationId } : { topic: question, conversationId };
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
        <div className="mb-4 flex items-center gap-3 text-[13.5px]">
          <button onClick={() => { setShowHistory(false); setHistoryDetail(null); }} className="font-medium text-muted underline underline-offset-2 hover:text-ink">← Back to asking</button>
          {historyDetail && (
            <button onClick={() => setHistoryDetail(null)} className="text-muted underline underline-offset-2 hover:text-ink">All conversations</button>
          )}
        </div>

        {!historyDetail && (
          <div className="space-y-2">
            {conversations.length === 0 && <p className="text-[14px] text-muted">No past conversations yet.</p>}
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className="block w-full rounded-xl border border-hairline bg-surface p-3.5 text-left transition-colors hover:border-hairline-strong"
              >
                <span className="text-[14px] font-medium text-ink">{c.title ?? 'Untitled'}</span>
                <span className="ml-2 text-[12px] text-muted">{new Date(c.updatedAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}

        {historyDetail && (
          <div className="space-y-3">
            <h2 className="font-display text-[18px] font-medium text-ink">{historyDetail.title ?? 'Conversation'}</h2>
            {historyDetail.turns.map((t, i) => (
              <div key={i} className="rounded-xl border border-hairline bg-surface p-4">
                <p className="text-[12px] font-medium uppercase tracking-wide text-muted-soft">You asked{t.kind === 'summary' ? ' (summary)' : ''}</p>
                <p className="mb-2.5 mt-1 text-[14px] font-medium text-ink">{t.questionText}</p>
                {t.status === 'no_grounded_answer' ? (
                  <p className="text-[14px] text-muted">No grounded answer.</p>
                ) : (
                  <>
                    <p className="text-[14.5px] leading-relaxed text-body-strong">{t.text}</p>
                    <CitationChips citations={t.citations} />
                    {t.edited && <p className="mt-1.5 text-[12px] text-muted">(your edited version)</p>}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const showEmptyState = state === 'idle' && !answer && !input.trim();

  return (
    <div>
      {/* mode segmented control + history */}
      <div className="mb-3 flex items-center gap-1">
        <div className="inline-flex gap-0.5 rounded-full bg-surface-strong p-0.5">
          <button
            onClick={() => setMode('ask')}
            className={`rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition-colors ${mode === 'ask' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-body-strong'}`}
          >
            Ask a question
          </button>
          <button
            onClick={() => setMode('summary')}
            className={`rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition-colors ${mode === 'summary' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-body-strong'}`}
          >
            Summarize a topic
          </button>
        </div>
        <button onClick={openHistory} className="ml-auto text-[13.5px] font-medium text-muted underline underline-offset-2 hover:text-ink">History</button>
      </div>

      {/* ask box */}
      <div className="flex items-center gap-2 rounded-2xl border border-hairline-strong bg-surface p-1.5 pl-4 transition-colors focus-within:border-ink">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={mode === 'ask' ? 'e.g. what did I do for authentication?' : 'e.g. authentication'}
          className="flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted-soft"
        />
        <button
          onClick={() => submit()}
          disabled={state === 'asking'}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[14px] font-medium text-white transition-colors hover:bg-ink disabled:opacity-70"
        >
          {state === 'asking' ? (
            <>
              <Spinner />
              Thinking…
            </>
          ) : mode === 'ask' ? 'Ask' : 'Summarize'}
        </button>
      </div>

      {/* welcoming empty state — clickable starters into the user's real synced work */}
      {showEmptyState && (
        <div className="mt-5">
          <p className="mb-2.5 text-[12px] font-medium uppercase tracking-[0.08em] text-muted-soft">Try asking</p>
          <div className="flex flex-wrap gap-2">
            {STARTERS.map((q) => (
              <button
                key={q}
                onClick={() => { setMode('ask'); submit(q); }}
                className="rounded-full border border-hairline bg-surface px-3.5 py-2 text-[13.5px] text-body-strong transition-colors hover:border-ink hover:text-ink"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {state === 'error' && <p className="mt-5 text-[14px] text-muted">Falcon is temporarily unavailable — try again in a moment.</p>}
      {answer?.status === 'no_grounded_answer' && (
        <p className="mt-5 rounded-xl border border-hairline bg-surface-strong/50 p-4 text-[14px] text-body">
          {answer.message ?? "I don't have anything in your synced work that answers this."}
        </p>
      )}

      {answer?.status === 'grounded' && (
        <div className="mt-6 space-y-3">
          {answer.claims.map((c, i) => (
            <div key={i} className="rounded-xl border border-hairline bg-surface p-4">
              <p className="text-[14.5px] leading-relaxed text-body-strong">{c.text}</p>
              <CitationChips citations={c.citations} />
            </div>
          ))}
          {answer.dataAsOf && (
            <p className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className="h-1 w-1 rounded-full bg-muted-soft" />
              Based on your work synced as of {new Date(answer.dataAsOf).toLocaleString()}.
            </p>
          )}

          {!editing && (
            <button
              onClick={() => { setEditing(true); setEditText(answer.claims.map((c) => c.text).join(' ')); }}
              className="text-[13px] font-medium text-muted underline underline-offset-2 hover:text-ink"
            >
              Not quite right? Edit this
            </button>
          )}
          {editing && (
            <div>
              <textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="h-32 w-full rounded-xl border border-hairline bg-surface p-3 text-[14px] text-ink outline-none focus:border-ink" />
              <button onClick={saveEdit} className="mt-2 rounded-full bg-primary px-4 py-2 text-[14px] font-medium text-white transition-colors hover:bg-ink">Save my version</button>
            </div>
          )}
          {editState === 'saved' && <p className="text-[12px] text-muted">Saved — your version is now what Falcon uses.</p>}
        </div>
      )}

      {answer?.decisionStatus && <DecisionStatusNote status={answer.decisionStatus} />}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
