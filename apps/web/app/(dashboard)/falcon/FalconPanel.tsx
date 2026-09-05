'use client';
import { useState } from 'react';

interface Citation { artifactId?: string; externalRef: string; title: string | null; type: string; url: string | null; snippet?: string }
type ClaimTier = 'confirmed' | 'from_comment';
interface Claim { text: string; citations: Citation[]; tier?: ClaimTier }
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
  syncWindowNote?: string;
  message?: string;
  conversationId?: string;
}

/** The four-state decision boundary (US2). Surfaces (a) a SUPERSEDED-lineage note when the answer is
 *  grounded on a confirmed decision that replaced an earlier one — so a reversed/updated decision is
 *  never presented as if it had no history (F10.1, the CTO's "did we change this?" ask); and (b) an
 *  UNCONFIRMED candidate as a neutral status line — existence + source pointer + queue link, NEVER its
 *  content. Both can co-occur ("we decided X, which changed an earlier call, and there's a new proposal"). */
function DecisionStatusNote({ status }: { status: DecisionStatus }) {
  const pending = status.proposed ?? status.pendingChange;
  const superseded = status.settled?.changed ? status.settled : undefined;
  if (!pending && !superseded) return null;

  const refs = pending?.sourceRefs.filter((r): r is string => !!r) ?? [];
  const from = refs.length ? ` (from ${refs.join(', ')})` : '';
  const lead = status.proposed
    ? "This isn't settled yet — there's an unconfirmed decision candidate"
    : 'Heads up: an unratified change to this decision has been proposed';
  const plural = pending && pending.count > 1 ? `${pending.count} candidates` : 'a candidate';

  return (
    <div className="mt-3 space-y-2">
      {superseded && (
        <p className="rounded-xl border border-hairline bg-surface-strong/50 p-3 text-[13.5px] text-body">
          This reflects a decision that replaced an earlier one — you&apos;re seeing the current version.{' '}
          <a href={`/decisions/${superseded.decisionId}`} className="font-medium underline decoration-dotted underline-offset-2 hover:text-ink">See what changed</a>
        </p>
      )}
      {pending && (
        <p className="rounded-xl border border-hairline bg-surface-strong/50 p-3 text-[13.5px] text-body">
          {lead}{pending.count > 1 ? ` — ${plural}` : ''}{from}.{' '}
          <a href={pending.queueLink} className="font-medium underline decoration-dotted underline-offset-2 hover:text-ink">Open the decision queue</a>
        </p>
      )}
    </div>
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

/** Provenance-strength badge — a factual statement about the SOURCE, never a confidence score.
 *  `confirmed` = grounded on a ratified decision; `from_comment` = the only support is a comment. */
function ClaimTierBadge({ tier }: { tier: ClaimTier }) {
  if (tier === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-forest/30 bg-forest/5 px-2 py-0.5 text-[11.5px] font-medium text-forest">
        ✓ Confirmed decision
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-brass/30 bg-brass/5 px-2 py-0.5 text-[11.5px] font-medium text-brass"
      title="This rests on a comment in discussion, not a confirmed record — worth verifying."
    >
      ⚠ From a comment
    </span>
  );
}

/** Trim an over-long retrieved passage for inline display (chunks are already bounded, but review
 *  comments / PR bodies can run long). Full source is one click away via the citation link. */
function clampSnippet(s: string, max = 500): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t;
}

/** One grounded claim: badge + text + citation chips, plus an expandable evidence panel that shows the
 *  actual retrieved passage per source — so a citation is a receipt you can READ, not just a link into a
 *  400-comment PR (round-1: senior SWE + journalist). Manages its own disclosure state. */
function ClaimCard({ claim }: { claim: Claim }) {
  const [open, setOpen] = useState(false);
  const hasEvidence = claim.citations.some((c) => c.snippet && c.snippet.trim());
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      {claim.tier && <div className="mb-2"><ClaimTierBadge tier={claim.tier} /></div>}
      <p className="text-[14.5px] leading-relaxed text-body-strong">{claim.text}</p>
      <CitationChips citations={claim.citations} />
      {hasEvidence && (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-2.5 text-[12.5px] font-medium text-muted underline underline-offset-2 hover:text-ink"
          >
            {open ? 'Hide evidence' : 'Show evidence'}
          </button>
          {open && (
            <div className="mt-2 space-y-2.5 border-t border-hairline pt-2.5">
              {claim.citations.map((c, j) => (
                <div key={j} className="text-[13px]">
                  <p className="font-medium text-body-strong">
                    {c.type} {c.externalRef}{c.title ? ` — ${c.title}` : ''}
                  </p>
                  {c.snippet && c.snippet.trim() && (
                    <p className="mt-0.5 whitespace-pre-wrap border-l-2 border-hairline pl-3 italic text-body">
                      {clampSnippet(c.snippet)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Grounded-in-real-work prompts. Every one queries the user's own synced artifacts — no fabricated
// data, just good entry points into what Falcon actually knows. Decision-led (the hero use case),
// then work/eng, so non-engineer testers see themselves in at least half the starters.
const STARTERS = [
  'What decisions have we made recently?',
  'What did I work on this week?',
  'What did I do for authentication?',
  'What decisions are waiting for me to confirm?',
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
          <p className="mt-4 max-w-xl text-[12.5px] leading-relaxed text-muted-soft">
            Falcon only answers from sources you&apos;ve connected, and only from work you have access to —
            it can&apos;t surface anything you couldn&apos;t open yourself.
          </p>
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
            <ClaimCard key={i} claim={c} />
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

      {answer?.syncWindowNote && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-hairline bg-surface-strong/50 p-3 text-[13.5px] text-body">
          <span aria-hidden>⏳</span>
          <span>{answer.syncWindowNote}</span>
        </p>
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
