/**
 * Decision Memory — the four-state source boundary (feature 005 US2; spec §5).
 *
 * When a decision candidate is relevant to a question, the answer resolves to one of:
 *   none · proposed_unconfirmed · confirmed(settled) · superseded
 * with `settled` and `pendingChange` able to CO-OCCUR ("we decided X, but there's an unratified
 * proposal to change it"). The load-bearing rule: an UNCONFIRMED candidate may cross the boundary
 * only as METADATA (existence + source pointer + queue link) — never its decision/rationale text,
 * and never as a citation. This resolver is PURE and runs OUTSIDE the LLM, so the model prompt never
 * sees unconfirmed content and therefore cannot quote or ground on it.
 */

/** Where a person can go to ratify the pending candidate(s). A link, never content. */
export const DECISION_QUEUE_LINK = '/decisions?tab=queue';

/** Non-evidential reference to unconfirmed candidate(s): a count, source pointers, and a queue link.
 *  Deliberately carries NO decision/rationale/options/title text. */
export interface PendingRef {
  count: number;
  sourceRefs: (string | null)[]; // e.g. "#482"; null when a manual entry had no source
  queueLink: string;
}

export interface DecisionStatus {
  /** A confirmed decision grounded the answer. `changed` = that record supersedes an earlier one. */
  settled?: { decisionId: string; changed: boolean };
  /** A relevant unconfirmed candidate exists ALONGSIDE a settled answer (co-occurs with `settled`). */
  pendingChange?: PendingRef;
  /** A relevant unconfirmed candidate exists and NOTHING confirmed grounded the answer. */
  proposed?: PendingRef;
}

/** Minimal shape the resolver needs from an answer — just citation types + ids, no content. */
export interface ResolverClaim {
  citations: readonly { type: string; artifactId: string }[];
}
/** Minimal shape from `matchUnconfirmedCandidates` — metadata only (no content fields). */
export interface UnconfirmedMatch {
  id: string;
  sourceRef: string | null;
  createdAt: string;
  distance: number;
}

function pendingRef(matches: readonly UnconfirmedMatch[]): PendingRef {
  return { count: matches.length, sourceRefs: matches.map((m) => m.sourceRef), queueLink: DECISION_QUEUE_LINK };
}

/**
 * Resolve the decision status for an answer (pure). `claims` are the SURVIVING grounded claims;
 * `unconfirmed` are the (already ceiling-filtered) unconfirmed matches; `supersedingIds` are confirmed
 * decision ids that supersede an earlier record (so a settled answer can be marked `changed`).
 * Returns undefined for the `none` state. `settled` and `pendingChange` co-occur.
 */
export function resolveDecisionStatus(
  claims: readonly ResolverClaim[],
  unconfirmed: readonly UnconfirmedMatch[],
  supersedingIds: ReadonlySet<string> = new Set(),
): DecisionStatus | undefined {
  // Settled: a surviving citation to a confirmed decision (that's how answerQuestion tags them).
  let settledId: string | undefined;
  for (const c of claims) {
    for (const cit of c.citations) {
      if (cit.type === 'decision') { settledId = cit.artifactId; break; }
    }
    if (settledId) break;
  }

  const settled = settledId ? { decisionId: settledId, changed: supersedingIds.has(settledId) } : undefined;
  const pending = unconfirmed.length > 0 ? pendingRef(unconfirmed) : undefined;

  if (settled && pending) return { settled, pendingChange: pending };
  if (settled) return { settled };
  if (pending) return { proposed: pending };
  return undefined; // none
}
