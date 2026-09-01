# Contract — `@falcon/core` functions

All functions are tenant-scoped via `deps.db.withTenant(workspaceId, …)` unless marked **pure**.
Signatures are the contract; bodies live in implementation. Existing exports keep their current
signatures (new params are **optional** to preserve callers).

## Lifecycle (decisions.ts)

```ts
createDecision(deps, workspaceId, input: {
  title: string; decision?: string; rationale?: string; options?: unknown;
  dissent?: string; ownerUserId?: string; sourceRef?: string; origin?: 'manual' | 'suggested';
}): Promise<{ id: string }>
// Inserts status='unconfirmed'; embeds title+decision at create (pinned Voyage); stamps embedding_model/version.

confirmDecision(deps, workspaceId, id: string, confirmedBy: string): Promise<{ status: 'confirmed' | 'noop' }>
// unconfirmed → confirmed (+confirmed_by/at). Idempotent: already-confirmed/superseded → 'noop'. Requires decision non-empty.

supersedeDecision(deps, workspaceId, args: {
  newRecordId: string; supersedesId: string;
}): Promise<{ superseded: string }>
// newRecord must be confirmed; sets its supersedes_id; flips old row → 'superseded'. Idempotent.

dismissDecision(deps, workspaceId, id: string): Promise<{ dismissed: boolean }>
// Sets dismissed_at=now() on an unconfirmed row. Idempotent. Confirmed/superseded rows → rejected.

listQueue(deps, workspaceId): Promise<QueueItem[]>
// status='unconfirmed' AND dismissed_at IS NULL, newest first (for the Unconfirmed Queue UI).
```

## Matching & status (decisions.ts + decision-status.ts)

```ts
// EXISTING — gains an optional precomputed query vector (R7). Behavior otherwise unchanged.
searchDecisions(deps, workspaceId, query: string, k?, horizonDays?, queryVec?: number[]): Promise<DecisionResult[]>
// Unchanged filter: status='confirmed' AND embedding IS NOT NULL. MAY also apply the R1 ceiling (decided in spike).

// NEW — metadata ONLY. Never selects decision/rationale/options/title.
matchUnconfirmedCandidates(deps, workspaceId, query: string, k?, queryVec?: number[]): Promise<UnconfirmedMatch[]>
// Filter: status='unconfirmed' AND dismissed_at IS NULL AND distance <= DECISION_RELEVANCE_MAX_DISTANCE.

// NEW — PURE. No deps, no I/O, fully unit-tested.
resolveDecisionStatus(answer: Answer, matches: UnconfirmedMatch[]): DecisionStatus | undefined
// settled: any surviving citation with type==='decision' (+changed if that record has supersedes_id).
// pendingChange/proposed: from `matches` (already ceiling-filtered) → metadata only.
// Returns undefined for the `none` state.
```

## Answer integration (answer.ts)

```ts
answerQuestion(deps, input): Promise<Answer>   // EXISTING signature unchanged.
// New internals:
//   1. embed query ONCE → queryVec.
//   2. pass queryVec to retrieve() and searchDecisions().
//   3. matchUnconfirmedCandidates(queryVec) (skip when the question is time-scoped to own activity).
//   4. answer.decisionStatus = resolveDecisionStatus(answer, matches).  // additive field on Answer
// The LLM prompt is UNCHANGED and never receives unconfirmed content.
```

`Answer` gains one optional field: `decisionStatus?: DecisionStatus`. `Citation` already carries
`type` (used to detect `'decision'`); confirmed-decision citations gain a resolvable `url` to the
detail view (see http.md) instead of today's `null`.

## Miner (miner.ts, Ship 2)

```ts
extractDecisionCandidate(deps, item: MergedPrOrClosedIssue): Promise<CandidateDraft | null>
// Pinned Haiku; returns null unless a clear decision signal. Logged to Langfuse + eval fixture.
// Caller (worker) createDecision(origin:'suggested') iff no existing record for item.sourceRef.
```
