# Ship 2 — Automatic Decision Capture from Synced Artifacts (the "decision miner")

**Date:** 2026-09-01
**Status:** Design (brainstorm complete; pre-plan)
**Feature area:** Decision Memory (PRD F10.1, F2.4 — the Org Decision Index / "moat")
**Depends on:** Ship 1 (Decision Records write path + lifecycle), spec `specs/005-decision-memory/`
**Related:** [[project-tester-wants-automatic-in-meeting]] — this is automatic capture *from artifacts*; the
in-meeting listener is a later, separate producer that reuses the same extractor core.

---

## 1. Problem & goal

Ship 1 built a trustworthy Decision Record notebook (unconfirmed → confirmed → superseded, with a
dismiss tombstone, provenance-gated retrieval), but **capture is manual** — a human types each decision
at `/decisions/new`. A memory tool that requires manual logging mostly stays empty, and an empty index
is no moat.

The tester who requested this feature wants capture to be **automatic**. Ship 2 delivers the first
automatic *front door*: a conservative LLM "decision-spotter" that reads already-synced GitHub/Linear
artifacts, detects when one records a real team decision, and drafts an **`unconfirmed`** Decision Record
into the **existing Ship-1 queue** for one-click human ratification.

**Non-goal (this ship):** the in-meeting listener (live transcript → decisions). It is a *second caller*
of the same extractor core, specced separately. The extractor's interface is designed now to serve it.

**North-star quality metric:** confirm-rate of suggested records (and its inverse, dismiss-rate). A
suggestion queue people stop reviewing is worse than no queue at all.

## 2. Decisions locked in the brainstorm

| # | Decision | Rationale |
|---|---|---|
| D1 | **Very conservative** posture | The failure mode is queue-flooding, not missing a decision. A noisy queue trains people to ignore it → feature death. |
| D2 | Sources = **merged PRs + completed issues** only | Deliberate, member-authored, `trusted`-tier outcomes. Highest signal, lowest cost/injection surface. Comments/commits excluded. |
| D3 | **Reactive** trigger | Mine when a PR flips merged / an issue completes, alongside the existing index job. Fresh (minutes), matches sync→index pattern. |
| D4 | **Never re-suggest a *dismissed candidate*** | Respect the human's "no." Enforced at *suggest-time*, keyed on the candidate (not the artifact) — so recalibration can still revisit the artifact. |
| D5 | Extractor is **input-agnostic, returns scored array** | The shared brain the meeting listener reuses. Policy (threshold) lives in the caller, not the brain. |
| D6 | **Owner is a hint** | The PR author often isn't the decision owner; Linear owner is `null` today. Confirm step must let a human set/change it. |
| D7 | **Shadow-calibrate before enforcing** | Offline run over existing history → pick threshold from labeled data against written-down acceptance criteria. |

## 3. Architecture — four new pieces on existing machinery

```
GitHub/Linear change ──► handleSync (existing)
   │  upsert artifact (existing) ── now also persists state + merged_closed_at
   │  enqueue index job (existing)
   │  NEW: if type∈{pr,issue} AND state∈{merged,completed}
   │       AND merged_closed_at > connection.mine_watermark
   │       → enqueue MineJob (concurrency-capped, coalescing jobId)
   ▼
handleMine(workspaceId, artifactId)                         [apps/worker/src/handlers.ts]
   1. load artifact (withTenant)
   2. ledger gate  — skip iff a mined_artifact row exists with matching extractorVersion AND
                     contentHash (regardless of result). Any version/hash change → re-mine.
   3. budget gate  — if workspace is over today's suggestion budget: write nothing,
                     re-enqueue delayed (jittered, high priority); return
   4. extractDecisions(deps, {segments:[{speaker:author, text:title+body}], sourceRef})   [core]
   5. for each candidate with score ≥ DECISION_MINE_MIN_CONFIDENCE:
        suggest-time suppression — skip if ANY decision_record exists with the same sourceRef
          AND normalized-title match: a *dismissed* one satisfies D4; a *live* one prevents a
          duplicate on re-mine. A materially different candidate (new title) still surfaces.
        else createDecision(origin:'suggested', sourceRef, ownerUserId:hint)   [Ship 1 — embeds on create]
   6. write mined_artifact row (result, extractorVersion, contentHash, decisionId?, maxCandidateScore)
   ▼
Ship-1 unconfirmed queue ──► human confirms (may edit owner) ──► retrievable (Ship 1, untouched)
```

### 3.1 `extractDecisions` — the shared brain  (`packages/core/src/decision-extract.ts`, NEW)

```ts
export interface DecisionSegment { speaker: string | null; text: string }
export interface ExtractInput { segments: DecisionSegment[]; sourceRef: string; ownerHint?: string | null }
export interface ScoredCandidate {
  title: string; decision: string; rationale?: string; options?: unknown;
  dissent?: string; ownerHint?: string | null; score: number; // 0..1
}
export function extractDecisions(deps: CoreDeps, input: ExtractInput): Promise<ScoredCandidate[]>
```

- Pure function; the only I/O is `deps.llm.chat.complete` (pinned Haiku).
- **Returns an array** (a transcript window can hold ≥2 decisions) and **the score survives the
  function** — thresholding is the *caller's* policy, not the brain's (D5).
- `segments` carry speaker attribution so `dissent`/`owner` are extractable from a meeting later. The
  miner passes a single segment; the meeting listener will pass many.
- **Untrusted-input boundary (F7.2):** `segments` text is inserted as a delimited *data* block; the
  system prompt / instructions live only in the privileged channel. The prompt is conservative by
  construction ("only extract a deliberate choice between alternatives worth remembering; else return
  []").
- Returns `[]` on "no decision," on empty input, or after a single failed JSON re-parse (see §5).

### 3.2 `handleMine` — the Ship-2 producer  (`apps/worker/src/handlers.ts`)

Consumes `MineJob = { workspaceId, artifactId }`. Orchestrates the ledger gate → budget gate → extract
→ suggest-time suppression → `createDecision` → ledger write, per §3 diagram. Owner hint comes from the
artifact's already-resolved `userId` (GitHub author via existing `memberLoginMap`; `null` for Linear).

**Provenance is gated by construction:** `sourceRef` written to the record comes from the *triggering
artifact*, never from anything the model emits. A candidate cannot manufacture a citation to an artifact
it wasn't run on. (Pinned by a test — §6.)

### 3.3 The `mined_artifact` ledger  (NEW table)

Purpose: mine each artifact once per extractor version + content, cheaply and idempotently, while
keeping bad-prompt-era artifacts recoverable on recalibration.

Skip predicate (in `handleMine` step 2) — **one rule, regardless of `result`:** skip iff a
`mined_artifact` row exists whose `extractor_version` AND `content_hash` both equal current. Any version
bump or content change makes the artifact **re-minable** — this is the calibration loop, and it applies
even to artifacts that previously produced a `suggested` record.

Duplicate-prevention and D4 ("never re-suggest a dismissed candidate") are therefore **both** enforced
at *suggest-time* (step 5), keyed on the *candidate*: a re-minted candidate is dropped if a
`decision_record` with the same `sourceRef` and a **normalized-title match** (case-, whitespace-, and
trailing-punctuation-insensitive) already exists — *dismissed* (D4) or *live* (dedup). A version bump
that yields a **materially different** decision from the same artifact (new title) still surfaces — the
recovery case for bad-prompt-era artifacts.

### 3.4 Queue wiring  (`packages/queue`, `apps/worker/src/index.ts`)

- `mineQueue()` + `MineJob` alongside `sync`/`index`/`digest`.
- **`jobId = mine:{ws}:{artifactId}:{extractorVersion}:{contentHash8}`** — coalesces concurrent
  identical enqueues; a version/content change is a new id, so BullMQ's `removeOnComplete: 1000`
  retention (verified in `queue/src/index.ts`) can't silently swallow a legitimate re-mine. Budget-defer
  re-enqueues append `:d{dayBucket}` (the UTC `YYYY-MM-DD` the retry targets) so each day's retry is a
  distinct id.
- **Concurrency cap** on the mine worker (`MINE_QUEUE_CONCURRENCY`) so a backlog can't stampede Haiku /
  the Voyage 3-RPM tier.

## 4. Schema changes — migration 0005

> **Discipline:** 0005 MUST be appended to `packages/db/package.json`'s migrate script *and* to the
> test-DB bootstrap. This was Ship-1 review-finding #1 (a migration that CI/prod never ran). Never again.

1. **`artifact.state text null`** + **`artifact.merged_closed_at timestamptz null`**.
   Requires extending `ArtifactInput` and **both adapters** (verified: neither reads state today):
   - GitHub PR: read `merged_at`/`closed_at`/`state` → `state ∈ {merged, closed, open}` (`merged` =
     `merged_at` set; `closed` = `closed_at` set & `merged_at` null; else `open`).
   - Linear issue: read workflow state → `state ∈ {completed, canceled, started, ...}`.
   `merged`/`closed` and `completed`/`canceled` are kept **distinct** — the "we decided *not* to" source
   (`closed`-unmerged, `canceled`) is a deferred candidate, not a non-event, and must stay recoverable.
2. **`decision_record.origin text not null default 'manual'`** — `createDecision` already accepts
   `origin` but doesn't persist it; the queue UI badges "Suggested from PR #482" off this. (`source_ref`
   already exists for the link.)
3. **`mined_artifact`** table: `(workspace_id, artifact_id) pk, mined_at, result, extractor_version,
   content_hash, decision_id null, max_candidate_score real null`. RLS-scoped like every tenant table.
   `max_candidate_score` is stored on `no_decision` rows too → the production drop-zone score
   distribution, queryable, zero reviewer burden ("if the cutoff were 0.6, how many more surface?").
4. **`connection.mine_watermark timestamptz null`** — set to `now()` at connect-time (the backfill
   guard). **0005 backfills `now()` for all existing connections** so the historical-mining blowup can't
   fire on current/pilot connections at deploy. `null` is treated as "no historical mining" (safe).

## 5. Error handling & edge cases

The `mined_artifact.result` enum — `suggested | no_decision | error | deferred` — is the spine.

| Path | Behavior | Why |
|---|---|---|
| **Over daily budget** *(quiet-data-loss risk)* | Write nothing; **re-enqueue with jittered delay past midnight, higher priority**. Never a ledger row. | Budget *delays*, never destroys. Jitter avoids a 00:00 thundering herd; priority drains backlog ahead of fresh syncs so it can't starve. |
| **Malformed LLM JSON** | One inline re-call; still bad → `result='error'`, return (no throw). | Same input+prompt+model → same failure; retrying on the full backoff burns the budget + rate limit re-deriving it. `error` is re-minable on a version bump. |
| **No decision** | `result='no_decision'` + `max_candidate_score`. | Re-minable on version/hash change; feeds the drop-zone histogram. |
| **Transient (network/5xx/429)** | Throw → BullMQ backoff (`defaultJobOpts`, 5 attempts). | Genuinely retriable. |
| **Artifact missing** | Return quietly. | Mirrors `handleIndex`. |

## 6. Testing

- **Unit** (fake `ChatProvider`, deterministic JSON): clear ADR PR → 1 candidate; routine bugfix → `[]`;
  multi-decision window → 2 candidates (proves the array/meeting path); score exactly at threshold
  boundary; malformed JSON → one re-call then `error`.
- **Provenance-gate (security-shaped, pinned structurally):** fake `ChatProvider` returns a candidate
  whose JSON carries a `sourceRef` to a *different* artifact → assert the stored record uses the
  triggering artifact's ref and ignores the model's.
- **Integration** (real Postgres + RLS): seed artifact → `handleMine` → `suggested` record with
  `origin`/`sourceRef`; re-run same version → ledger skip, no dup; **dismiss → bump version → re-mine →
  identical candidate suppressed at suggest-time, a materially different candidate would surface**;
  over-budget → re-enqueued delayed, no record, no ledger row; Ship-1 guarantee holds (mined record not
  retrievable until confirmed).
- **Extractor eval fixture** (real Haiku, modeled on `packages/evals/src/decision-ceiling.ts`): labeled
  corpus → precision/recall → informs `DECISION_MINE_MIN_CONFIDENCE`.
- **Migration:** assert 0005 is in both the migrate script and the test-DB bootstrap.

## 7. Shadow calibration (pre-enforcement, one-off)

The eval fixture measures **capability** (curated base rate, unrealistic by design); a shadow run over
**real history** measures **volume** (suggestions/week — the number that decides whether the review
ritual survives). Both are needed. The `mine_watermark=now()` backfill permanently excludes existing
history from *production* mining, so this one-off run is the only way that data is ever used.

Procedure:
1. A one-off script runs `extractDecisions` over the existing artifact backlog (merged PRs + completed
   issues) **into a shadow table/file — never the queue.** Full sample, same day, blocks nothing.
2. Output = score histogram + suggestions-per-week estimate at the repo's real activity level.
3. **Hand-label first, criteria first, then read the data.** Label top ~50 by score + a random ~30 from
   the mid band. Write acceptance criteria *before* looking: e.g. *chosen cutoff yields ≥80% precision
   on the labeled set AND ≤10 suggestions/week.* Labeling is ~1–2h and **cannot be delegated to the
   model that produced the candidates**; if it doesn't happen, this degrades to enforcing blind.
4. Pick the threshold from the labeled data. If nothing meets both criteria, that's a finding about the
   prompt — not license to move the goalposts.
5. Flip to enforcing. **Live dismiss-rate instrumentation remains the real validator** — the shadow run
   (one team, largely one author) is a defensible day-one number, not a general calibration.

## 8. Config constants (all PROVISIONAL until §7)

- `DECISION_MINE_MIN_CONFIDENCE` — suggest-time cutoff.
- `DECISION_MINE_DAILY_BUDGET` — per-workspace suggestions/day flood guard.
- `MINE_QUEUE_CONCURRENCY` — mine-worker concurrency cap.
- `EXTRACTOR_VERSION` — **derived** = `hash(promptTemplate + modelId)`, not hand-bumped (silent-forget
  failure otherwise). A tuned prompt makes all `no_decision`/`error` history re-minable via config.
- `contentHash` — hash of the **`segments` passed to the extractor** (not title+body), so it widens
  automatically if the adapter later includes comments.

## 9. Observability

Parametrize the Langfuse generation name to `'mine'` (hardcoded `'digest'` today in
`packages/llm/src/index.ts`); log `score` + `result`. Dashboard the confirm-rate / dismiss-rate of
`origin='suggested'` records — the north-star.

## 10. Explicitly deferred

- **In-meeting listener** (second caller of `extractDecisions`) — separate spec.
- **`closed`-unmerged / `canceled` as "decided not to" source** — recorded distinctly (§4.1), mined
  later.
- **Two-tier confidence UI** — revisit from the `max_candidate_score` data, not from taste.
- **Comments/commits as sources**, **semantic dedup vs existing confirmed decisions** — YAGNI for v1.
- **Owner-picker at confirm** — small Ship-1 UI addition required by D6; tracked, minimal.
