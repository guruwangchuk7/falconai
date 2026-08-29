---
description: "Task list for Personal Falcon (Phase 2)"
---

# Tasks: Personal Falcon

**Input**: Design documents from `specs/002-personal-falcon/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md
**Tests**: INCLUDED — this repo is test-first (constitution "Spec before code"; Phase 1 precedent).

## ⚠️ Blocking gates before ANY implementation task (Constitution I + Setup gate)

- [x] **G1** PRD amended (v2.8 changelog + §17 Phase-2 scope note + Open Q8 update) — additive only,
  `design.md`/`landing.html` untouched. Narrow scope: sanctions the personal Q&A capability; full
  solo-first reposition stays held pending the Phase-2 solo-retention read. Draft:
  `reviews/prd-d1-amendment-draft.md`.
- [ ] **G2** Owner gives explicit approval to start application code (Setup gate).
- [ ] **G3** Confirm whether any PRD §22 AD-1…AD-8 governs the retrieval/answer path; if so, resolve
  by spike before the dependent task.

Do not start Phase 1 tasks until G1–G3 clear.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: parallelizable (different files, no incomplete-task dependency)
- **[Story]**: US1/US2/US3; Setup/Foundational/Polish carry no story label

---

## Phase 1: Setup

- [x] T001 [P] Create migration file `packages/db/drizzle/0002_personal_falcon.sql` (placeholder) and wire it into the `@falcon/db` migrate order after `0001_init.sql`
- [x] T002 [P] Scaffold the answer-grounding eval + golden-set fixtures in `packages/evals/answer/` (Constitution V)

---

## Phase 2: Foundational (BLOCKS all user stories) — shared answer pipeline + data

**⚠️ No user-story work begins until this phase is complete.**

- [x] T003 Add tenant-scoped entities to `packages/db/src/schema.ts`: `conversation`, `question`, `answer`, `answer_citation`, `query_event` (per data-model.md)
- [x] T004 Author `packages/db/drizzle/0002_personal_falcon.sql`: create the tables, `enable`/`force row level security`, `workspace_id` tenant-isolation policies, and grants to `falcon_app` (depends T003)
- [x] T005 [P] Integration guard `tests/integration/personal-falcon-rls.test.ts`: new tables fail-closed without tenant ctx, isolate by workspace, reject mismatched-workspace inserts (extends the Phase-1 isolation suite; run as `falcon_app`)
- [x] T006 [P] Define `Answer`/`Claim`/`Citation` types + Zod schema in `packages/core/src/answer.ts` (per contracts/api.md)
- [x] T007 Implement grounded-answer core in `packages/core/src/answer.ts`: reuse `retrieve.ts` for ACL/tenant candidates → Claude Haiku (pinned version) structured claims+citations → deterministic **verify-then-drop** (claim dropped if its citation ∉ retrieved set) → `Answer` (`grounded` | `no_grounded_answer`). **Accepts prior conversation turns as context for follow-up questions (FR-011)** — earlier Q&A is included in the prompt but does NOT relax the grounding gate (follow-ups are re-grounded against freshly retrieved candidates). (depends T003, T006)
- [x] T008 [P] Unit test `packages/core/src/answer.test.ts`: verify-then-drop removes ungrounded claims; zero survivors → `no_grounded_answer`; confirmed-decisions-only filter (depends T007)
- [x] T009 [P] Pin the answer model version in `packages/llm` and log answer inputs+citations for the eval (Constitution V)
- [x] T010 [P] Ask API scaffold `apps/web/app/api/falcon/ask/route.ts`: Auth.js session + `withTenant` wiring + rate limit (reuse `@falcon/queue` limiter) + SSE stream skeleton
- [x] T011 [P] Falcon panel shell `apps/web/app/(dashboard)/falcon/page.tsx` + dashboard nav entry (readable answer area + citation-link component)

**Checkpoint**: shared answer pipeline, tenant-isolated tables, API + panel shells ready.

---

## Phase 3: User Story 1 — Ask about my own work (P1) 🎯 MVP

**Goal**: A user privately asks about their own work and gets a grounded, cited answer.
**Independent Test**: single user asks "what did I do for auth?" → cited answer resolves to real artifacts; a no-source question → honest "no grounded answer."

- [x] T012 [P] [US1] Contract test `tests/contract/falcon-ask.test.ts`: grounded ask → every `claims[].citations[].artifactId` ∈ retrieved ACL set; ≥1 citation per rendered claim (contracts/api.md test 1)
- [x] T013 [P] [US1] Contract test (same file or `-negative`): no supporting artifact → `no_grounded_answer`, no fabricated text (test 2)
- [x] T014 [US1] Wire `/api/falcon/ask` to the answer core: stream claims, attach verified citations, persist `conversation`/`question`/`answer`/`answer_citation` via `withTenant` (depends T007, T010)
- [x] T015 [US1] Emit exactly one `query_event` per ask (retention, SC-005) in the ask path (depends T014)
- [x] T016 [US1] Panel: ask box + streamed answer + clickable citations resolving to artifact URLs (depends T011, T014)
- [x] T017 [US1] Surface `data_as_of` / last-synced freshness in the answer (FR-014)
- [x] T018 [US1] Degraded state: provider/embeddings error → honest `503` message, never a guessed answer (Constitution IV)

**Checkpoint**: US1 fully functional and independently testable — this is the MVP.

---

## Phase 4: User Story 2 — Ask about the team's work (P2)

**Goal**: Access-scoped team-context Q&A ("what happened with Feature X?").
**Independent Test**: user asks about accessible team work → cited answer; inaccessible artifact → never cited; another user's conversation → 404.

- [x] T019 [P] [US2] Integration test `tests/integration/falcon-acl.test.ts`: accessible team artifact cited; inaccessible artifact never surfaced; cross-user conversation read → 404 (contracts/api.md test 3)
- [x] T020 [US2] Confirm team-scope retrieval draws only from ACL-visible artifacts (reuse `retrieve.ts` ACL); extend the answer core scope if needed (depends T007)
- [x] T021 [US2] Enforce confirmed-decisions-only when a citation is a `decision_record` (FR-007; contracts test 4) (depends T007)

**Checkpoint**: US1 + US2 both work independently.

---

## Phase 5: User Story 3 — Targeted prep summary + edit (P3)

**Goal**: Scoped, grounded prep summary the user can edit (edit is authoritative).
**Independent Test**: request a summary scoped to a topic → grounded brief; edit + reload → edited text persists as authoritative.

- [ ] T022 [P] [US3] Contract test `tests/contract/falcon-summary.test.ts`: `/summary` (scoped) grounded + `PATCH /answers/{id}` edit-authoritative (contracts/api.md tests 6)
- [x] T023 [US3] Generalize `packages/core/src/digest.ts` → scoped summary via the answer core (topic/time scope) (depends T007)
- [x] T024 [US3] Routes: `POST /api/falcon/summary` + `GET /api/falcon/conversations` + `GET /api/falcon/conversations/{id}` (depends T023, T014)
- [x] T025 [US3] `PATCH /api/falcon/answers/{id}` → `edited_text` authoritative (mirror the Phase-1 digest edit) (depends T014)
- [x] T026 [US3] Panel: request summary + edit/save; conversation list/read (depends T016)

**Checkpoint**: all three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting

- [x] T027 [P] Run the answer-grounding eval on the golden set; must clear its bar before ship (Constitution V) (`packages/evals/answer/`)
- [ ] T028 [P] Playwright authed e2e: open panel → ask → cited answer (`apps/web` e2e, extends T043 shell)
- [x] T029 [P] Add answer/ask paths to observability (Sentry/PostHog) for error + retention visibility
- [ ] T030 Run `quickstart.md` V1–V9 and confirm all pass
- [x] T031 [P] Docs: add the Falcon Q&A surface to `START-HERE.md` / handoff; note SC-005 retention as the D1 confirm metric
- [x] T032 [P] Measure answer latency (SC-003): instrument time-to-first-token + time-to-complete over a representative question set; set a streaming budget and confirm median complete < ~10s (validates quickstart V7)

---

## Dependencies & Execution Order

- **Gates G1–G3** block everything (PRD amendment + owner approval + AD check).
- **Setup (P1)** → **Foundational (P2)** → **User Stories (P3–P5)** → **Polish (P6)**.
- Foundational blocks all stories (shared answer core T007 + tables T003/T004).
- After Foundational: US1 → US2 → US3 in priority order, or parallel if staffed (they're independent; US2/US3 reuse T007 but don't depend on US1's UI).
- Within a story: tests (T012/T013, T019, T022) before implementation.

## Parallel opportunities

- Setup: T001, T002 in parallel.
- Foundational: T005, T006, T008, T009, T010, T011 are [P] (distinct files) once T003/T004/T007 land in order.
- US1 tests T012/T013 in parallel before T014.
- Across stories: US1/US2/US3 can run in parallel post-Foundational with different developers.

## Implementation strategy

- **MVP = Phase 1 + 2 + US1 (T001–T018).** Ship the personal self-work Q&A, measure SC-005 solo
  retention — that read confirms/updates D1 before investing further.
- Then US2 (team context), US3 (summaries), then Polish + eval + quickstart.

## Notes
- Every rendered claim must carry a verified citation (Constitution II) — this is enforced in T007
  and guarded by T008/T012/T013, not left to the prompt.
- All new tables run under `falcon_app` RLS (Constitution III), guarded by T005/T019.
- Model version pinned; grounding judgment measured on a golden set before any prompt/model change
  (Constitution V) — T009/T027.
