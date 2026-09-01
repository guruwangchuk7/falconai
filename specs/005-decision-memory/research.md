# Phase 0 Research — Decision Memory

Consolidated decisions for the plan. The only true unknown from the spec is the **relevance ceiling**;
the rest are confirmations of design-doc choices verified against the code.

## R1. The relevance ceiling (the make-or-break unknown) — SPIKE

**Question**: What single absolute cosine-distance cutoff decides whether an unconfirmed candidate is
"relevant enough" to surface as status metadata (and, optionally, whether a confirmed search hit is
real at small corpus size)?

**Decision**: Do **not** hardcode. Introduce one workspace-level constant
`DECISION_RELEVANCE_MAX_DISTANCE` and **calibrate it on a seeded corpus** via a new `@falcon/evals`
fixture before Ship 1 exits. `<=>` in pgvector with `vector_cosine_ops` returns cosine distance in
`[0,2]` (0 = identical). The cutoff is a **maximum distance**: surface only candidates with
`distance ≤ ceiling`.

**Method (the spike)**:
1. Seed ~20–30 realistic decisions (drawn from this repo's own history: STT provider choice, memory-
   layer-first, privacy model, host choice, etc.) + ~15 deliberately unrelated ones.
2. For a labeled set of question→expected-decision pairs (and question→"nothing relevant" negatives),
   record the nearest-candidate distance.
3. Pick the ceiling that maximizes: **no false "there's a candidate" on negatives** (precision first —
   a spurious footer is the death-by-noise failure) while keeping true matches. Start strict (≈ the
   90th percentile of true-match distances), loosen only on evidence.
4. Log the chosen value + the calibration table to the fixture output; wire the "status-resolver fire
   rate" metric so drift is visible in the pilot.

**Rationale**: Constitution V (measure judgments, don't guess) + PRD AD-resolution-by-spike. At pilot
scale (tens of records) a fixed top-k with no ceiling returns arbitrary neighbours (spec Edge Case);
the ceiling is what makes small-corpus behavior honest.

**Alternatives rejected**: (a) hardcode a constant — unfalsifiable, likely wrong at small N;
(b) top-k only — returns unrelated nearest neighbour; (c) an LLM relevance judge — adds a call + a
place for unconfirmed content to leak, defeating the boundary.

**Also decide in the spike**: whether to apply the same ceiling to `searchDecisions` (confirmed) to
kill small-corpus false positives there too. Default: yes, behind the same constant.

## R2. Embed-on-create, not on confirm

**Decision**: Compute + store the record embedding at **create** time (manual and miner). Confirm only
flips status + stamps confirmer/at. **Rationale**: makes unconfirmed candidates *matchable* (so their
existence can be surfaced) while the `status = 'confirmed'` filter remains the sole grounding gate —
embedding presence is a search prerequisite, never the evidence gate. Verified: `decision_record.
embedding` is **nullable** in DDL, so unembedded rows are legal but ours will always embed.
**Alternative rejected**: embed-on-confirm — then unconfirmed can't be matched, breaking the four-state
boundary.

## R3. Metadata-only unconfirmed matching

**Decision**: New `matchUnconfirmedCandidates(deps, workspaceId, query|queryVec, k)` returns
`{ id, sourceRef, createdAt, distance }[]` **only** — never `decision` / `rationale` / `options`.
Filters `status = 'unconfirmed' AND dismissed_at IS NULL` and applies the R1 ceiling.
**Rationale**: enforces "unconfirmed never becomes evidence" at the **type level** — the content
fields are not even fetched, so they cannot leak into a prompt or citation (spec FR-008).
**Alternative rejected**: reuse `searchDecisions` with a status flag — it selects content columns; a
future edit could leak them. A separate narrow function is the safer contract.

## R4. Deterministic status resolver, outside the LLM

**Decision**: New pure function `resolveDecisionStatus(answer, unconfirmedMatches)` → `DecisionStatus`.
It detects a **grounded** decision by scanning the already-produced `answer.claims[].citations[]` for
`type === 'decision'` (that is exactly how `answerQuestion` tags decision candidates today — verified
in `answer.ts`), and independently checks `unconfirmedMatches`. Emits: `settled` (with optional
`changed` when the grounded record has a `supersedesId`), and/or `pendingChange` / `proposed_
unconfirmed` carrying `{ sourceRefs, queueLink, count }` only; else omit. **Rationale**: the LLM prompt
is unchanged and never sees unconfirmed content, so it *cannot* quote/ground it; states co-occur
(spec FR-009). Pure → fully unit-testable. **Alternative rejected**: ask the model to classify status —
reintroduces leakage + a subjective call.

## R5. `settled` + `pendingChange` co-occurrence

**Decision**: `DecisionStatus` carries an optional `pendingChange` field *alongside* `settled`, not a
mutually-exclusive enum. **Rationale**: "we decided Deepgram, but there's an unratified proposal to
switch" is the highest-value case; a single-state resolver would answer confidently stale (spec §5,
FR-009). **Alternative rejected**: exclusive states — drops the most decision-memory-ish situation.

## R6. Dismiss = `dismissed_at` column (not a status value)

**Decision**: Migration `0004_decision_dismissed_at.sql` does `ALTER TABLE decision_record ADD COLUMN
dismissed_at timestamptz` (+ partial index `where dismissed_at is not null` optional). Dismiss sets it;
matching filters `dismissed_at IS NULL`. **Rationale**: `decision_record` is hash-partitioned (16
parts) and `status` has a raw-DDL `CHECK (status in (...))`; adding a 4th enum value means constraint
surgery across the parent + partitions. `ADD COLUMN` cascades cleanly, gives an audit timestamp, and
keeps dismiss **orthogonal** to the unconfirmed/confirmed/superseded lifecycle. **Alternative
rejected**: `status='dismissed'` — CHECK-constraint migration on a partitioned table + overloads the
lifecycle semantics. Confirmed via `0001_init.sql:110`.

## R7. Embed the query once (Voyage RPM)

**Decision**: In `answerQuestion`, embed the query **once** (`llm.embeddings.embed([q],'query')`) and
thread the vector into `retrieve`, `searchDecisions`, and `matchUnconfirmedCandidates` via a new
optional `queryVec` param on each (falls back to embedding internally when absent, preserving existing
callers). **Rationale**: today `retrieve` + `searchDecisions` embed independently (2 calls); adding
matching would make 3. Voyage free-tier RPM is low (run gotchas) → 3 calls throttles the pilot to
~1 Q/min. **Alternative rejected**: leave three calls — pilot-breaking latency/limits.

## R8. Writes under RLS

**Decision**: All create/confirm/supersede/dismiss run inside `deps.db.withTenant(workspaceId, tx=>…)`.
**Rationale**: verified `setup-app-role.sql` grants `insert,update,delete` to `falcon_app` and the RLS
policy has `with check (workspace_id = current_setting('app.workspace_id'))`, so inserts/updates that
set the tenant's `workspace_id` are permitted and cross-tenant writes are refused. The acting user for
`ownerUserId` / `confirmedBy` comes from `getActiveSession().userId` (verified present).
**Alternative rejected**: service-role write bypass — violates Constitution III.

## R9. Ship-2 miner (conservative, pinned, logged)

**Decision**: BullMQ job on the existing sync path; a **pinned Claude Haiku** call classifies a merged
PR / closed issue as decision-bearing and, if so, emits one `unconfirmed` candidate (pre-filled +
`sourceRef`), embedded on create, skipping any `sourceRef` that already has a record. Every judgment is
logged to Langfuse and added to an eval fixture (Constitution V). Bias to **fewer, clearer**
candidates. **Rationale**: bootstraps the index without meetings; human confirms (FR-016).
**Alternative rejected**: heuristic-only (noise floods the queue) or auto-confirm (violates HITL).

## Open after Phase 0

None blocking. R1's numeric value is produced by the calibration fixture during Ship 1 implementation
(a task in `tasks.md`), not invented here — that is the correct place for it.
