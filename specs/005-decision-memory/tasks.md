---
description: "Task list — Decision Memory (feature 005)"
---

# Tasks: Decision Memory

**Input**: Design documents from `specs/005-decision-memory/` (plan.md, spec.md, research.md,
data-model.md, contracts/, quickstart.md).

**Tests**: Requested — unit (pure), integration on real Postgres with RLS, e2e Playwright. Included below.

**Organization**: By user story. **Ship 1 = US1–US4** (write path + four-state boundary). **Ship 2 = US5**
(auto-miner). Each story is an independently testable increment.

**Format**: `[ID] [P?] [Story?] Description (file path)` — `[P]` = parallelizable (different files, no
incomplete deps).

**PRD trace / Constitution**: grounded-or-silent (II), only-confirmed-grounds (F10.1/R23), RLS (III/§12.9),
human-in-the-loop, pinned models (§12.8), measure judgments via Langfuse (V).

---

## Phase 1: Setup — the make-or-break spike

**Purpose**: Resolve the one open unknown (research.md R1) BEFORE it's baked into US2. Produces the
calibrated `DECISION_RELEVANCE_MAX_DISTANCE`; do NOT hardcode blind.

- [X] T001 Add `@falcon/evals` calibration fixture `packages/evals/src/decision-ceiling.ts`: seed ~25
  realistic decisions (from this repo's history) + ~15 unrelated; a labeled set of question→expected /
  question→"none" pairs; embed via pinned Voyage; print the nearest-candidate cosine-distance
  distribution and a precision/recall table over positives vs negatives.
- [ ] T002 Run the fixture (`packages/evals/src/decision-ceiling.ts`), choose the ceiling that yields
  zero false-positive "candidate exists" on negatives while retaining true matches; record the value +
  calibration table in `specs/005-decision-memory/research.md` (R1 result note).
- [X] T003 Add the calibrated constant `DECISION_RELEVANCE_MAX_DISTANCE` to `packages/config/src/index.ts`
  (workspace-tunable default; documented as calibrated, not guessed).

**Checkpoint**: The relevance ceiling is a known, justified number wired as config.

---

## Phase 2: Foundational (blocking prerequisites for all stories)

**Purpose**: Schema delta + the embed-once refactor that US1–US4 build on.

**⚠️ No user-story work starts until this phase is complete.**

- [X] T004 Create migration `packages/db/drizzle/0004_decision_dismissed_at.sql`:
  `ALTER TABLE decision_record ADD COLUMN dismissed_at timestamptz;` (cascades to the 16 hash
  partitions). **Do NOT** alter the `status` CHECK constraint. Optional partial index
  `create index decision_dismissed_idx on decision_record (workspace_id) where dismissed_at is not null;`.
- [X] T005 Add `dismissedAt: timestamp('dismissed_at', { withTimezone: true })` to `decisionRecord` in
  `packages/db/src/schema.ts` (depends on T004).
- [X] T006 Embed-query-once (research.md R7): add an optional `queryVec?: number[]` param to
  `retrieve()` in `packages/core/src/retrieve.ts` and `searchDecisions()` in
  `packages/core/src/decisions.ts` — use it when present, else embed internally (preserves existing
  callers). No behavior change for current callers.
- [X] T007 [P] Unit test the queryVec plumbing in `packages/core/src/retrieve.test.ts` /
  `decisions.test.ts`: passing a precomputed vector skips the internal embed call (spy asserts one/zero
  embed calls) and returns identical results.

**Checkpoint**: Schema has `dismissed_at`; retrieval accepts a shared query vector.

---

## Phase 3: User Story 1 — Capture & confirm (Priority: P1) 🎯 MVP

**Goal**: Log a decision → confirm it → it becomes retrievable and answerable; detail view + clickable
citation. Quickstart Scenario A.

**Independent Test**: `POST /api/decisions` → not in confirmed search → `PATCH confirm` → appears in
`/decisions` search AND grounds a cited Falcon answer whose citation links to `/decisions/[id]`.

### Tests for US1 ⚠️ (write first, must fail)

- [X] T008 [P] [US1] Integration test `packages/core/src/decisions.int.test.ts` (real Postgres, RLS on):
  `createDecision` inserts `unconfirmed` + non-null embedding; not returned by `searchDecisions`;
  `confirmDecision` sets `confirmed` + `confirmed_by`/`confirmed_at` and then IS returned; confirm is
  idempotent. (Mirrors the feature-001 integration harness.)
- [X] T009 [P] [US1] e2e `apps/web/e2e/decisions.e2e.spec.ts`: log a decision via `/decisions/new`,
  confirm from the queue, see it in search + open its detail view.

### Implementation for US1

- [X] T010 [US1] Implement `createDecision(deps, workspaceId, input)` in `packages/core/src/decisions.ts`
  — insert `status:'unconfirmed'`, embed title+decision at create (pinned Voyage), stamp
  `embedding_model`/`embedding_version`; via `withTenant`. (contracts/core.md)
- [X] T011 [US1] Implement `confirmDecision(deps, workspaceId, id, confirmedBy)` in
  `packages/core/src/decisions.ts` — unconfirmed→confirmed, stamp confirmer/at, idempotent no-op on
  confirmed/superseded; via `withTenant`.
- [X] T012 [US1] Implement `listQueue(deps, workspaceId)` in `packages/core/src/decisions.ts` —
  `status='unconfirmed' AND dismissed_at IS NULL`, newest first (returns content for the confirm UI).
- [X] T013 [US1] Export the new core functions from `packages/core/src/index.ts`.
- [X] T014 [US1] Add `POST` to `apps/web/app/api/decisions/route.ts` — validate body, call
  `createDecision`, 201 `{id}` / 400 / 401. (contracts/http.md)
- [X] T015 [US1] Create `apps/web/app/api/decisions/[id]/route.ts` with `PATCH {action:'confirm'}` →
  `confirmDecision(id, session.userId)`; 200/404(RLS no-row)/409(illegal).
- [X] T016 [P] [US1] Create `apps/web/app/(dashboard)/decisions/new/page.tsx` + `DecisionForm.tsx`
  (client) posting to `POST /api/decisions`.
- [X] T017 [P] [US1] Create `apps/web/app/(dashboard)/decisions/[id]/page.tsx` + `DecisionDetail.tsx`:
  decision, rationale, dissent, owner, options, sourceRef, status, confirmer/at, supersede chain,
  freshness flag. This is the citation target (FR-011).
- [X] T018 [US1] Extend `apps/web/app/(dashboard)/decisions/page.tsx` — keep search; add an Unconfirmed
  Queue section (`listQueue`) with per-item Confirm action + a "Log a decision" link.
- [X] T019 [US1] Make confirmed-decision citations clickable: in `packages/core/src/answer.ts`
  `citationUrl`, resolve a `decision`-source item to `/decisions/{artifactId}` (was `null`); render the
  link in `apps/web/app/(dashboard)/falcon/FalconPanel.tsx`.

**Checkpoint**: US1 fully functional — capture→confirm→cited answer with a clickable detail link. MVP.

---

## Phase 4: User Story 2 — Four-state answer boundary (Priority: P1)

**Goal**: none / proposed_unconfirmed / confirmed(settled) / superseded, with `settled`+`pendingChange`
co-occurring; unconfirmed surfaced as metadata only, never evidence. Quickstart Scenario B (+F).

**Independent Test**: seed 1 confirmed + 1 unconfirmed; assert confirmed→grounded+cited,
unconfirmed→status line with zero content/citation, "confirmed + pending" shows both, and the response
payload contains no unconfirmed-content strings.

### Tests for US2 ⚠️ (write first, must fail)

- [X] T020 [P] [US2] Pure unit test `packages/core/src/decision-status.test.ts`: `resolveDecisionStatus`
  returns `settled` (via a `type==='decision'` citation), `proposed`, `settled`+`pendingChange`
  (co-occur), and `undefined` (none) for the right inputs; never includes decision/rationale/options text.
- [X] T021 [P] [US2] Unit test `packages/core/src/decisions.test.ts`: `matchUnconfirmedCandidates` result
  objects have ONLY `{id, sourceRef, createdAt, distance}` keys (no content fields) and exclude
  `dismissed_at IS NOT NULL` rows and rows beyond the ceiling.
- [X] T022 [P] [US2] Integration test `packages/core/src/answer.int.test.ts` (real Postgres): the four
  Scenario-B cases end-to-end; a leakage assertion greps the full answer payload for seeded unconfirmed
  strings and expects zero; exactly ONE query-embed call per question (Scenario F).

### Implementation for US2

- [X] T023 [US2] Implement `matchUnconfirmedCandidates(deps, workspaceId, query|queryVec, k)` in
  `packages/core/src/decisions.ts` — SELECT only `id, source_ref, created_at, distance`;
  `status='unconfirmed' AND dismissed_at IS NULL AND distance <= DECISION_RELEVANCE_MAX_DISTANCE`; via
  `withTenant`. (contracts/core.md, R3)
- [X] T024 [P] [US2] Implement pure `resolveDecisionStatus(answer, matches)` in NEW
  `packages/core/src/decision-status.ts` — detect settled via `answer.claims[].citations[].type==='decision'`
  (+`changed` if that record has `supersedesId`); build `pendingChange`/`proposed` from `matches`
  (metadata only). Export from `index.ts`. (R4/R5)
- [X] T025 [US2] Add `decisionStatus?: DecisionStatus` to the `Answer` type in
  `packages/core/src/answer.ts` and the `DecisionStatus`/`PendingRef` types (data-model.md §2).
- [X] T026 [US2] Integrate in `answerQuestion` (`packages/core/src/answer.ts`): embed query ONCE →
  `queryVec`; pass to `retrieve` + `searchDecisions`; call `matchUnconfirmedCandidates(queryVec)` (skip
  when time-scoped to own activity); set `answer.decisionStatus = resolveDecisionStatus(...)`. LLM prompt
  UNCHANGED. (R7)
- [X] T027 [US2] Render `answer.decisionStatus` in `apps/web/app/(dashboard)/falcon/FalconPanel.tsx` — a
  neutral footer ("Not settled yet — unconfirmed candidate(s) [from #NN] · Open the queue") for
  proposed/pendingChange; nothing extra for settled. No unconfirmed content rendered. (contracts/http.md)

**Checkpoint**: The safety invariant holds from the first record; US1+US2 both work independently.

---

## Phase 5: User Story 3 — Supersede (Priority: P2)

**Goal**: reversed decisions never read as live. Quickstart Scenario C.

**Independent Test**: confirm A; supersede with B; ask topic → B grounds, A excluded + `superseded`, chain
shown in detail.

### Tests for US3 ⚠️

- [X] T028 [P] [US3] Integration test `packages/core/src/decisions.int.test.ts` (append): supersede flips
  old→`superseded`, links `supersedes_id`, excludes old from `searchDecisions`; idempotent.

### Implementation for US3

- [X] T029 [US3] Implement `supersedeDecision(deps, workspaceId, {newRecordId, supersedesId})` in
  `packages/core/src/decisions.ts` — require new record confirmed; set its `supersedes_id`; flip old →
  `superseded`; idempotent; via `withTenant`. Export.
- [X] T030 [US3] Add `PATCH {action:'supersede', supersedesId}` to
  `apps/web/app/api/decisions/[id]/route.ts`.
- [X] T031 [US3] Show the supersede chain (A→B) in `DecisionDetail.tsx`
  (`apps/web/app/(dashboard)/decisions/[id]/`).

**Checkpoint**: US1–US3 independently functional.

---

## Phase 6: User Story 4 — Dismiss (Priority: P2)

**Goal**: reject a candidate; never grounds, never a status line, never re-suggested. Quickstart Scenario D.

**Independent Test**: dismiss an unconfirmed candidate → gone from queue + status surfacing; (Ship 2)
miner does not recreate it.

### Tests for US4 ⚠️

- [X] T032 [P] [US4] Integration test `packages/core/src/decisions.int.test.ts` (append): `dismissDecision`
  sets `dismissed_at`, removes it from `listQueue` and `matchUnconfirmedCandidates`; idempotent; rejects
  dismiss on confirmed/superseded.

### Implementation for US4

- [X] T033 [US4] Implement `dismissDecision(deps, workspaceId, id)` in `packages/core/src/decisions.ts` —
  set `dismissed_at=now()` on an unconfirmed row; reject confirmed/superseded; idempotent; via
  `withTenant`. Export.
- [X] T034 [US4] Add `PATCH {action:'dismiss'}` to `apps/web/app/api/decisions/[id]/route.ts` and a
  Dismiss action on each queue item in `decisions/page.tsx`.

**Checkpoint**: Ship 1 complete (US1–US4). Run Quickstart A–F.

---

## Phase 7: User Story 5 — Auto-suggest miner (Priority: P3) — Ship 2

**Goal**: conservatively propose decisions from merged PRs / closed issues into the same queue; human
confirms. Quickstart... (miner half of Scenario D re-suggestion).

**Independent Test**: a decision-bearing merged PR yields exactly one `unconfirmed` candidate; a routine
PR yields none; never auto-confirmed; a dismissed sourceRef is not re-suggested.

### Tests for US5 ⚠️

- [ ] T035 [P] [US5] Unit test `packages/core/src/miner.test.ts`: `extractDecisionCandidate` returns a
  draft for a decision-bearing item and `null` for a routine one (fixture inputs).
- [ ] T036 [P] [US5] Integration test `apps/worker` (or `packages/core`): `handleMine` skips a `sourceRef`
  that already has any decision_record (confirmed/superseded/dismissed), preventing re-suggestion.

### Implementation for US5

- [ ] T037 [US5] Add `MineJob` interface + `mineQueue()` to `packages/queue/src/index.ts` (mirrors
  `SyncJob`/`IndexJob`).
- [ ] T038 [US5] Implement `extractDecisionCandidate(deps, item)` in NEW `packages/core/src/miner.ts` —
  pinned Haiku (`deps.llm.chat`), conservative (clear decision signal only), returns `CandidateDraft|null`;
  log the judgment to Langfuse (`@falcon/observability`). (V)
- [ ] T039 [US5] Add `handleMine(deps, job)` to `apps/worker/src/handlers.ts` + a `Worker<MineJob>` in
  `apps/worker/src/index.ts`; on a draft, `createDecision(origin:'suggested')` iff no existing record for
  `item.sourceRef`.
- [ ] T040 [US5] Enqueue mine jobs from the existing sync/index flow (`apps/worker/src/handlers.ts`
  `handleSync`/`handleIndex`) for newly merged PRs / closed issues.
- [ ] T041 [P] [US5] Add a miner eval fixture in `packages/evals/src/` logging suggestion
  precision/recall on a labeled PR/issue set (V — measure the judgment).

**Checkpoint**: Ship 2 complete; miner feeds the same confirm queue, HITL preserved.

---

## Phase 8: Polish & cross-cutting

- [ ] T042 [P] Instrumentation (research.md §11): emit confirmations/week, unconfirmed-queue age,
  decision-questions/engineer-week (answers citing a decision or carrying `decisionStatus`), and
  status-resolver fire rate via `@falcon/observability`.
- [ ] T043 [P] Run the full `specs/005-decision-memory/quickstart.md` A–F against real Postgres and record
  results.
- [ ] T044 [P] Update `apps/web` nav/copy to "Decision Memory" framing (keep code term "Org Decision
  Index"; no PRD change).
- [ ] T045 Verify all five CI checks pass (typecheck/build/integration/e2e/no-token-in-db) on the PR.

---

## Dependencies & Execution Order

- **Phase 1 (Setup/spike)**: first; T001→T002→T003 sequential (fixture → run → wire constant).
- **Phase 2 (Foundational)**: after Setup; T004→T005 sequential; T006 independent; T007 after T006.
  **Blocks all user stories.**
- **US1 (P3)**: after Phase 2. T010→T011→T012 (same file `decisions.ts`, sequential); T013 after; routes
  T014/T015 after core; UI T016/T017 [P]; T018 after T012; T019 after T011.
- **US2 (P4)**: after Phase 2 (and reuses US1's `answer.ts`/panel). T023→T024→T025→T026 sequential (touch
  `decisions.ts`/`answer.ts`); T027 after T026. Needs T003 (ceiling) + T006 (queryVec).
- **US3 (P5)**, **US4 (P6)**: after US1 (share `decisions.ts` + `[id]/route.ts`); mutually orderable.
- **US5 (P7, Ship 2)**: after US1 (`createDecision`) + US4 (`dismissed_at` dedup).
- **Polish (P8)**: after the shipped stories.

### Within-file serialization (NOT [P])

`packages/core/src/decisions.ts` (T010,T011,T012,T023,T029,T033), `answer.ts` (T025,T026),
`apps/web/app/api/decisions/[id]/route.ts` (T015,T030,T034), `decisions/page.tsx` (T018,T034),
`DecisionDetail.tsx` (T017,T031) — same files → sequential.

### Parallel opportunities

- Phase 2: T006 ∥ (T004→T005).
- US1 UI: T016 ∥ T017. Tests T008 ∥ T009.
- US2 tests T020 ∥ T021 ∥ T022; T024 (new file `decision-status.ts`) ∥ T023's test.
- Polish: T042 ∥ T043 ∥ T044.

---

## Implementation Strategy

- **MVP = Phase 1 + Phase 2 + US1** — capture→confirm→cited answer. Stop, run Quickstart A, demo.
- **Ship 1 = + US2, US3, US4** — the safe four-state source. Run Quickstart A–F; deploy to the pilot
  engineers ($0 Oracle VM). Measure SC-006/SC-007.
- **Ship 2 = US5** — the miner, once Ship 1 has traction.

## Notes

- Constitution gates are per-task, not afterthoughts: RLS on every core fn (via `withTenant`), pinned
  models (Voyage/Haiku), grounded-or-silent + only-confirmed-grounds, HITL (miner suggests only),
  measure judgments (Langfuse + eval fixtures).
- The relevance ceiling (T001–T003) is a hard gate before US2 ships — no hardcoded constant.
- `/speckit-implement` is gated on the owner's explicit approval (constitution setup-gate).
