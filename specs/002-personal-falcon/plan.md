# Implementation Plan: Personal Falcon

**Branch**: `002-personal-falcon` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-personal-falcon/spec.md`

## Summary

Turn the shipped Phase 1 context layer into a **personal agent a user can ask**: a private,
conversational, grounded Q&A over the user's own and access-scoped team work, plus targeted prep
summaries. Technical approach: a retrieval-augmented answer path built on the existing
`@falcon/core` retrieval spine (pgvector search + Voyage rerank) and `@falcon/llm` (Claude Haiku),
with a **grounding gate applied to answers** (every claim must bind to a retrieved, ACL-checked
artifact ID or be dropped — Gate 3 for answers, Constitution II). Delivered as a panel in the
existing Next.js dashboard. No audio, pairing, or Coordinator (Phases 3-4).

## Technical Context

**Language/Version**: TypeScript on Node.js 24; React 19 (Next.js 15 App Router).

**Primary Dependencies**: existing workspace packages `@falcon/core` (retrieve/ingest/digest),
`@falcon/db` (Drizzle + postgres.js, RLS via `falcon_app`), `@falcon/llm` (Claude via Anthropic
SDK, Voyage embeddings + rerank), `@falcon/queue` (BullMQ) — all shipped in Phase 1. New work is
additive: an answer/conversation service in `@falcon/core` and a panel + API route in `apps/web`.

**Storage**: Postgres + pgvector (Supabase), existing schema + new tenant-scoped tables for
conversations / questions / answers / citations. Retrieval reuses `artifact` + `artifact_chunk` +
`decision_record`.

**Testing**: Vitest (unit + integration guards on real Postgres), Playwright (authed e2e) —
existing harness (`tests/support/pg.ts`, CI `ci.yml`).

**Target Platform**: web — Node server (Next.js server routes + worker) + browser (dashboard panel).

**Project Type**: web application (pnpm monorepo: `apps/web`, `apps/worker`, `packages/*`).

**Performance Goals**: median time-to-answer < ~10s (SC-003); stream tokens so first content is
near-instant. No live-meeting latency constraint (pull model).

**Constraints**: provenance gate — 0 ungrounded/fabricated claims (SC-001, Constitution II);
tenant isolation + ACL enforced at DB layer (SC-002, Constitution III); text-only; only confirmed
decision records retrievable (Constitution "human-in-the-loop"). Pinned model version, no `-latest`.

**Scale/Scope**: early-stage — tens of users, each querying their tenant's synced artifacts
(hundreds–thousands of chunks). One new UI surface (panel), one Q&A/answer service, one worker path
reused for any async summarization.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan complies |
|---|---|---|
| **I. PRD is law, traceability** | ⚠ **Action required** | Traces to PRD §17 (solo client phase), F7.2/R4/R20 (provenance), F10.1/R23 (decision records), R25/§12.9 (isolation), F10 (digest/self-context). **BUT** D1 (personal-Q&A-first reorder) is not yet applied to `PRD.md`. Per Principle I, the PRD must be amended to sanction the personal Q&A scope **before `/speckit-implement`.** Not a blocker for planning; it IS a gate before code. |
| **II. Grounded or silent** | ✅ | Answer path gates on retrieval: structured claims each carrying a retrieved artifact ID; a post-generation verifier drops any claim whose citation isn't in the retrieved, ACL-checked set. No source → "no grounded answer." |
| **III. Security = code** | ✅ | Retrieval runs through `withTenant` on the non-BYPASSRLS `falcon_app` role (proven live). Answers filter to ACL-visible artifacts. Tokens stay in the secrets store. New tables are tenant-scoped with RLS + FORCE. |
| **IV. Honest degradation** | ✅ | Explicit "no grounded answer," "source not connected," and last-synced freshness states rather than guessing. |
| **V. Measure judgments, pin models** | ✅ | The answer-grounding judgment is logged (inputs + citations) and measured against a golden set before prompt/model changes; Claude model version pinned; LLM behind the existing thin provider. Extend the Phase 1 `@falcon/evals` harness with an answer-grounding eval. |
| **Product invariants** | ✅ | Text-only. Human-in-the-loop: editable summaries, confirmed-decisions-only. Blame-neutral shared cards: N/A (personal Q&A has no shared cards). |

**Gate result**: PASS for planning. **One required action before implementation:** amend `PRD.md`
to apply D1 (owner-approved), so code does not diverge from the PRD. Also confirm whether any PRD
§22 Architecture-Decision-Pending (AD-1…AD-8) governs the Phase-2 retrieval/answer path; if so,
resolve it by spike in this phase before dependent code (Constitution "Development Workflow").

## Project Structure

### Documentation (this feature)

```text
specs/002-personal-falcon/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (Q&A/answer API + answer-object contract)
└── tasks.md             # /speckit-tasks output (NOT created here)
```

### Source Code (repository root)

```text
packages/
├── core/src/
│   ├── retrieve.ts        # EXISTING — reuse for candidate retrieval
│   ├── digest.ts          # EXISTING — coarse self-context; generalize for targeted summaries
│   └── answer.ts          # NEW — grounded Q&A: retrieve → generate → verify citations → drop ungrounded
├── db/src/
│   ├── schema.ts          # EXTEND — conversation / question / answer / citation / query-event tables (RLS+FORCE)
│   └── drizzle/0002_*.sql # NEW — migration for the above (+ grants to falcon_app)
├── llm/src/               # EXISTING — Claude provider (pin Haiku version), Voyage rerank
└── evals/                 # EXTEND — answer-grounding golden-set eval (Constitution V)

apps/web/
├── app/(dashboard)/falcon/        # NEW — the Falcon Q&A panel/sidebar page
│   └── page.tsx
├── app/api/falcon/ask/route.ts    # NEW — ask-a-question endpoint (streams a grounded answer)
└── app/api/falcon/conversations/  # NEW — list/read prior conversations

apps/worker/                       # EXISTING — reuse for any async summary jobs (optional)
```

**Structure Decision**: Extend the existing monorepo, additive only. The retrieval + LLM +
tenant-isolation spine already exists (Phase 1); Phase 2 adds one `answer` service, a small set of
tenant-scoped conversation tables, and one dashboard panel + API route. No new app, no desktop
client, no new infra.

## Complexity Tracking

> No constitution violations requiring justification. The one flagged item (I) is a required
> process step (amend the PRD for D1 before implementation), not added architectural complexity.
