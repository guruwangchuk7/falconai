# Implementation Plan: Decision Memory

**Branch**: `005-decision-memory` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-decision-memory/spec.md`; approved design doc
`docs/superpowers/specs/2026-09-01-decision-memory-design.md`.

## Summary

Add the **write path** (capture / confirm / supersede / dismiss) and a **confirmed/unconfirmed source
boundary** so Decision Records become a safe, populated knowledge source for Falcon's *already-shipped*
general-purpose Q&A. The read path (confirmed-only `searchDecisions`, decision-aware `answerQuestion`,
the `/decisions` search page) exists and is reused unchanged except for two additive hooks: a query
vector threaded through retrieval, and a status resolver that runs **outside** the LLM. The load-
bearing property is that unconfirmed content is *matchable but never evidence* — enforced mechanically
by embed-on-create, a metadata-only `matchUnconfirmedCandidates()`, and citation-type detection in a
pure resolver. Ship 1 = US1–US4; Ship 2 = the US5 auto-suggest miner.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 (ESM, `tsx`); React 19 / Next.js 15 App Router.

**Primary Dependencies**: `@falcon/core` (answer/retrieve/decisions), `@falcon/db` (Drizzle +
Postgres, `withTenant` RLS), `@falcon/llm` (Voyage `voyage-code-4` embeddings — pinned; Claude Haiku
pinned for the Ship-2 miner), `@falcon/queue` (BullMQ, Ship 2), `@falcon/observability` (Langfuse),
Next.js server actions / route handlers, Tailwind + the existing dashboard components.

**Storage**: Postgres + pgvector (Neon/Supabase). `decision_record` is **hash-partitioned by
workspace_id (16 partitions)**, RLS FORCED, HNSW cosine index on `embedding`, btree on
`(workspace_id, status)`.

**Testing**: Vitest unit (pure resolver + parse/ground helpers), integration against **real Postgres
with RLS on** (mirrors feature 001 SC-003/004 harness), Playwright e2e for the `/decisions` flows,
`@falcon/evals` fixture for the relevance-ceiling calibration.

**Target Platform**: Web dashboard (Next.js on Node) + worker (`apps/worker`, BullMQ) for Ship 2.

**Project Type**: Web application (monorepo: `apps/web`, `apps/worker`, `packages/*`).

**Performance Goals**: A decision Q&A issues **exactly one** Voyage embed call for the query
(regression from today's 2, prevents 3). Manual capture/confirm p95 < 1.5 s including embed. Status
resolver adds no LLM call (pure + one vector query).

**Constraints**: Grounded-or-silent; only `confirmed` grounds; zero unconfirmed-content leakage into
generated text or citations; RLS tenant isolation on every op; pinned models; Voyage free-tier RPM is
low (embed-once matters).

**Scale/Scope**: Pilot = ~5 engineers, one workspace, tens→low-hundreds of decision records. Small-
corpus correctness (relevance ceiling) is a first-class concern at this scale.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| **I. PRD Is Law, Traceability** | Every FR traces to a PRD ID | ✅ spec §PRD-traceability; FRs cite F10.1/F7.2/R23/etc. |
| **II. Grounded or Silent** | Gate on retrieval; only confirmed grounds; unverifiable dropped | ✅ FR-007/008/010; resolver outside LLM; `searchDecisions` confirmed-only unchanged |
| **III. Security = Code** | RLS tenant isolation; provenance-gated | ✅ FR-017; all ops via `withTenant`; writes covered by RLS `with check` + `falcon_app` grants |
| **IV. Honest Degradation** | Degraded-but-honest over guessing | ✅ FR-009/010 four-state; "not settled yet" instead of false "nothing on record" |
| **V. Measure Judgments, Pin Models** | Log LLM judgments to golden set; pin versions | ✅ FR-018 pinned Voyage/Haiku; miner (a subjective judgment) logged to Langfuse + an eval fixture; **relevance ceiling calibrated on a seeded set, not guessed** |
| **Human-in-the-loop on memory** | unconfirmed→confirmed→superseded; only confirmed retrievable; Falcon proposes, never executes | ✅ FR-003/004/016; miner only suggests |
| **Respect roadmap order** | Don't build a later phase early | ✅ builds on shipped Phase 1/2; live mediation (Phase 3→4) explicitly out of scope |
| **AD resolved by spike, not paper** | Pending decisions get a spike in-phase | ✅ the relevance ceiling is resolved by a calibration spike (Phase 0 research + `@falcon/evals` fixture), not a hardcoded constant |

**Result: PASS.** No violations; Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/005-decision-memory/
├── plan.md              # This file
├── research.md          # Phase 0: relevance-ceiling calibration + key technical decisions
├── data-model.md        # Phase 1: decision_record delta (dismissed_at) + status/resolver entities
├── quickstart.md        # Phase 1: end-to-end validation guide (capture→confirm→answer, boundary)
├── contracts/           # Phase 1: core fn signatures + HTTP route contracts
│   ├── core.md
│   └── http.md
├── checklists/
│   └── requirements.md  # from /speckit-specify (all-pass)
└── tasks.md             # /speckit-tasks (NOT created here)
```

### Source Code (repository root)

```text
packages/
├── core/src/
│   ├── decisions.ts          # EXTEND: createDecision, confirmDecision, supersedeDecision,
│   │                         #   dismissDecision, matchUnconfirmedCandidates (metadata-only),
│   │                         #   listQueue; searchDecisions gains optional precomputed queryVec
│   ├── decision-status.ts    # NEW: pure resolveDecisionStatus(answer, matches) → DecisionStatus
│   ├── answer.ts             # EXTEND: embed query once; thread queryVec; attach decisionStatus
│   ├── retrieve.ts           # EXTEND: accept optional precomputed queryVec (no behavior change)
│   └── miner.ts              # NEW (Ship 2): extractDecisionCandidates(prOrIssue) → candidate|null
├── db/
│   ├── drizzle/0004_decision_dismissed_at.sql  # NEW migration: ADD COLUMN dismissed_at (+ index)
│   └── src/schema.ts         # EXTEND: decisionRecord.dismissedAt
├── evals/src/                # NEW fixture: decision-ceiling.ts (calibration set + runner)
├── queue/src/                # Ship 2: enqueue miner jobs on sync
└── observability/            # log miner judgments + status-resolver fire rate

apps/
├── web/app/(dashboard)/decisions/
│   ├── page.tsx              # EXTEND: search + Unconfirmed Queue + "Log a decision"
│   ├── new/ + [id]/          # NEW: capture form + detail view (rationale/dissent/options/chain)
│   ├── DecisionForm.tsx / QueueItem.tsx / DecisionDetail.tsx   # NEW client components
│   └── api unchanged GET; ...
├── web/app/api/decisions/
│   ├── route.ts              # EXTEND: add POST (create)
│   └── [id]/route.ts         # NEW: PATCH (confirm | supersede | dismiss)
├── web/app/(dashboard)/falcon/FalconPanel.tsx  # EXTEND: render decisionStatus footer + citation links
└── worker/src/handlers.ts    # Ship 2: miner job handler
```

**Structure Decision**: Reuse the existing monorepo layout. Business logic (lifecycle, matching,
status resolution, mining) lives in `@falcon/core` as pure/tenant-scoped functions so it is unit- and
integration-testable without the web layer; `apps/web` adds thin route handlers + server components;
`apps/worker` + `@falcon/queue` carry the Ship-2 miner. No new package.

## Complexity Tracking

> No constitution violations — section intentionally empty.
