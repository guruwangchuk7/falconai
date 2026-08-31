---
description: "Task list for Pairing (Phase 3)"
---

# Tasks: Pairing — Shared, Correctly-Attributed Sessions

**Input**: Design documents from `specs/004-pairing/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (ws-client-worker, sse-panel, rest-pairing), quickstart.md
**Tests**: INCLUDED — this repo is test-first (constitution "Spec before code"; Phase 1/2 precedent).

## ⚠️ Blocking gates before ANY implementation task (Constitution I + Setup gate)

- [x] **G1** Owner gives explicit approval to start Phase 3 **application code** (Setup gate) —
  **APPROVED by Guru 2026-08-31.** Rationale: the warm engineers will adopt only the fully-built
  product, so building Phase 3→4 (all $0 local dev) is the path to their usage; deploy waits on
  Dabtong House funding. No PRD amendment needed — Phase 3 is already sanctioned (PRD §17).
- [ ] **G2** **AD-1 clock-sync build spike** lands and its pass-bar is met **before** `merge.ts`
  ordering code (T023): on 2–3 real paired sessions over asymmetric links, server-arrival ordering +
  error margins correctly flags ambiguous pairs and produces **no confident mis-order** (research R1,
  PRD §22 AD-1). Blocks **T023 only**; the rest of the phase may proceed.
- [x] **G3** **AD-2 resolved** — LangGraph deferred for Phase 3; Participant Agents are in-worker async
  tasks (research R2, §6.3). No build spike; re-evaluate at Phase 4. *(Decided on paper.)*

Do not start Phase 1 tasks until G1 clears. T023 additionally waits on G2.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: parallelizable (different files, no incomplete-task dependency)
- **[Story]**: US1/US2/US3; Setup/Foundational/Polish carry no story label
- **Scope guard**: this phase is **strictly plumbing** — no task produces a mediation card, private
  nudge, intervention gate, or Decision Record (those are Phase 4, FR-023/FR-026).

---

## Phase 1: Setup (scaffolding)

- [x] T001 [P] Scaffold `apps/session-worker` (Fastify + `ws` + tsconfig) and wire into the pnpm workspace + turbo pipeline — boots + serves `/health` (verified)
- [x] T002 [P] Scaffold `apps/desktop` Tauri 2: `src-tauri` Rust crate + React webview that imports shared panel components from `apps/web` — **scaffold only; build deferred (needs Rust toolchain, see `apps/desktop/README.md`)**
- [x] T003 [P] Scaffold `packages/stt` thin provider interface skeleton mirroring the `@falcon/llm` provider pattern (interface + no-op stub + `FALCON_FAKE_STT` seam) — incl. `FakeSttProvider`/`FakeSttStream`
- [x] T004 [P] Create placeholder migration `packages/db/drizzle/0003_pairing.sql` and wire it into the `@falcon/db` migrate order after `0002_personal_falcon.sql` — migrate now chains `0001→0002→0003`
- [x] T005 [P] Two-client deterministic harness skeleton in `tests/support/two-client.ts` (fake-STT seam + Testcontainers Redis helper), mirroring Phase 2's `FALCON_FAKE_LLM` approach
- [x] T006 [P] STT fault-injection shim skeleton in `tests/support/stt-fault-shim.ts` (kill socket / inject latency / garble finals)

---

## Phase 2: Foundational (BLOCKS all user stories) — data, event log, ownership, transport, STT

**⚠️ No user-story work begins until this phase is complete.**

- [x] T007 Add tenant-scoped tables to `packages/db/src/schema.ts`: `session`, `session_membership`, `session_code`, `consent_pair`, `open_thread`, `session_visibility_scope`, `session_event` (per data-model.md)
- [x] T008 Author `packages/db/drizzle/0003_pairing.sql`: create the tables, `enable`/`force row level security`, `workspace_id` isolation policies, and grants to `falcon_app` (depends T007)
- [x] T009 [P] Integration guard `tests/integration/pairing-rls.test.ts`: new tables fail-closed without tenant ctx, isolate by workspace, reject mismatched-workspace inserts (extends the Phase-1 isolation suite; run as `falcon_app`) (§12.9/R25) — **5 tests pass on real Postgres**
- [x] T010 Redis event-log module `apps/session-worker/src/eventlog.ts`: append-before-action to `session:{id}:events`, snapshot cache, replay fold for merged transcript / membership / threads (CX-1, §12.3)
- [x] T011 [P] Unit test `tests/integration/eventlog.test.ts`: deleting all snapshots is a correctness no-op; replay reproduces identical folds (SC-005 property) — **CX-1 proven on real Redis**
- [x] T012 Ownership module `apps/session-worker/src/ownership.ts`: Redis lease + TTL heartbeat + monotonic fencing token; symmetric per-worker reconciler claims owned-vs-held delta (§12.5, R14, §6.3)
- [x] T013 [P] Integration test `tests/integration/session-ownership.test.ts`: fencing monotonicity, stale-token rejection (split-brain impossible), reconciler picks up a dead worker's sessions — **4 tests pass**
- [x] T014 Session worker `apps/session-worker/src/server.ts`: Fastify + `ws` bootstrap, consistent-hash `session_id` pinning, lease-holder-only writes/publishes (§6.3, §12.5) — `runIngest` appends attributed to the connection owner only while lease-held; `tests/integration/session-ingest.test.ts` (4 tests: /health, parse, attribution, split-brain guard)
- [x] T015 [P] STT circuit breaker in `packages/stt/src/circuit.ts`: primary → failover at the utterance boundary, one-way (no flapping), confidence-calibration seam (§12.9, research R3). Real Deepgram/AssemblyAI adapters need keys (deferred); the breaker orchestration is complete + tested
- [x] T016 [P] STT failover test `tests/unit/stt-failover.test.ts` via the fault shim: primary total_loss → utterance-boundary failover to secondary, no permanent gap (research R3)

**Checkpoint**: tenant-isolated tables + event-sourced state + fencing ownership + WS/STT substrate ready.

---

## Phase 3: User Story 1 — Pair into a shared, correctly-attributed session (P1) 🎯 MVP

**Goal**: Two people on their own Falcons join one session (calendar / team-auto / code) and everything either says lands in one merged transcript with exact attribution; consent-once + always-visible capture indicator.
**Independent Test**: two clients pair, speak over each other → one merged transcript, correct per-speaker attribution, no cross-talk misattribution; capture indicator visible throughout.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [x] T017 [P] [US1] Contract test `tests/contract/rest-pairing.test.ts`: resolve / team-auto-ack / join-by-code + consent gate + code TTL/rate/scope rejections + cross-tenant 404 (contracts/rest-pairing.md; F7, §7.2, §12.9)
- [ ] T018 [P] [US1] Contract test `tests/contract/ws-client-worker.test.ts`: attribution = connection owner, append-before-ack, fencing filter, lossless `resync` (contracts/ws-client-worker.md; G2/§6.1, §12.5)
- [ ] T019 [P] [US1] Integration test `tests/integration/pairing-attribution.test.ts` (two-client harness): overlapping speech → correct per-speaker attribution, zero cross-talk misattribution (SC-002)

### Implementation for User Story 1

- [ ] T020 [US1] Desktop capture in `apps/desktop/src-tauri`: `cpal` mic capture + Silero VAD (ONNX Runtime); stream **VAD-gated frames only**; raw audio **never stored**; sequence-addressable local ring buffer for resync; drive the always-visible capture indicator (F4, §12.2, §12.3/R6, research R4)
- [ ] T021 [US1] Desktop WS client + buffered `resync` in `apps/desktop/src-tauri` (client side of contracts/ws-client-worker.md; §12.3)
- [ ] T022 [US1] Worker WS ingest → STT stream → `utterance_final` appended to event log; **attribution set to the connection owner, never voice-inferred** (`server.ts` + `eventlog.ts`; G2, §6.1)
- [ ] T023 [US1] **[GATED on G2]** AD-1 spike + `apps/session-worker/src/merge.ts`: server-arrival ordering, per-client reorder buffer sized from measured jitter, per-utterance error margins, `order_confidence`, ambiguous-on-overlap marking, and **never-drop / explicit gap-mark** (F5/F5.3, §12.6, research R1)
- [x] T024 [P] [US1] Pairing REST routes `apps/web/app/api/session/*`: `resolve` (calendar, F7.1), `team-auto/ack` (F7.2), `join-by-code` + `POST /{id}/code` mint with TTL/rate/scope (F7.3), `leave`; all via Auth.js + `withTenant`/RLS (contracts/rest-pairing.md)
- [x] T025 [P] [US1] Calendar session-key matching in `packages/integrations/src`: shared Google/MS Calendar event id → session key (F7.1)
- [x] T026 [US1] Consent once-per-pair: `consent_pair` read/write, internal-remembered vs cross-workspace-always-prompt, one-time consent card UI naming shared/not-shared + revoke (§7.2, §12.4)
- [ ] T027 [US1] SSE panel stream `apps/web/app/api/session/[id]/stream/route.ts`: `session_state`, `transcript_append` (with `ambiguous_order`), `transcript_gap`, `capture_indicator`, `coverage_notice`, fencing filter — **event enum contains no card/nudge/escalation** (contracts/sse-panel.md; FR-023)
- [ ] T028 [US1] Panel UI (shared React in `apps/web` + Tauri webview): "Paired with X · N others" + one-tap Leave, live merged transcript with attribution + marked gaps, always-visible capture indicator (§7.2, §12.4)
- [ ] T029 [US1] Degradation ladder: unpaired speaker **not captured** + coverage gap flagged; network loss → local buffer + resync + marked gap; solo (nobody paired) still works (§7.3, F4.7-cut, Constitution IV)

**Checkpoint**: two people pair and get one correctly-attributed shared transcript. MVP demoable.

---

## Phase 4: User Story 2 — Each participant's agent reads the shared feed (P2)

**Goal**: One Participant Agent per human on the merged feed (ACL-scoped to its owner), and `session_visibility_scope` (ACL intersection) computed at pairing and on every join/leave.
**Independent Test**: pair two → exactly two agents provisioned, each retrieving only its owner's ACL-visible artifacts; scope recomputed when a third joins or someone leaves.

### Tests for User Story 2 ⚠️

- [ ] T030 [P] [US2] Integration test `tests/integration/session-visibility-scope.test.ts`: scope = the true ACL intersection on join/leave, version-stamped, stale scope never used (SC-007, F9.1a)
- [ ] T031 [P] [US2] Integration test `tests/integration/agent-acl-isolation.test.ts` (two-client): each agent retrieves only its owner's ACL-visible artifacts; no out-of-scope artifact reachable (SC-007, §12.9/R25)

### Implementation for User Story 2

- [ ] T032 [US2] `apps/session-worker/src/visibility.ts`: compute `session_visibility_scope` = ACL intersection at pairing; recompute on every join/leave; version-stamp; **compute-only, publishes nothing** (F9.1a)
- [ ] T033 [US2] `apps/session-worker/src/agents.ts`: one Participant Agent per human as an in-worker async task; compile the F3 Context Pack via Phase-1 retrieval + Phase-2 answer core; ACL-scoped via `withTenant`; consumes the merged feed and produces **no published output** (§6.3, FR-015/FR-026, research R2)
- [ ] T034 [US2] Late-joiner + leave lifecycle: provision an agent mid-session backfilled with a compressed transcript; tear down on leave; recompute visibility scope (F3, F9.1a)

**Checkpoint**: US1 + US2 — multi-agent session with correct per-owner ACL scope and the Phase-4 visibility-scope precondition in place.

---

## Phase 5: User Story 3 — Shared open-thread tracking (P3)

**Goal**: A live, event-sourced Open Threads table matching utterances to threads — tracking only, no gates/cards.
**Independent Test**: a two-topic discussion that drifts and returns produces a correct open/continue/merge/split thread table that recomputes identically from the log.

### Tests for User Story 3 ⚠️

- [ ] T035 [P] [US3] Integration test `tests/integration/open-threads.test.ts` (two-client): two-topic drift → correct open/continue/merge/split; router emits a score not a thread id; recompute-from-log is identical; assert **no gate/card/escalation type exists** (US3; SC-005 fold property; F6.1a)

### Implementation for User Story 3

- [ ] T036 [US3] Triage router emits `continuation_likelihood` + topic embedding (voyage-code-4) per utterance — **a score, never an `open_thread_id`** (F6.1a); reuse/extend the F6 router path
- [ ] T037 [US3] `apps/session-worker/src/threads.ts`: worker-owned Open Threads table as a fold over the utterance→thread mapping; explicit-threshold match + new-thread + merge/split; **counters recomputed, never incremented** (CX-1, F6.1a)
- [ ] T038 [US3] SSE `thread_update` events (opened/matched/merged/split) — tracking only; archive `open_thread` rows to Postgres at session end (contracts/sse-panel.md; data-model.md)

**Checkpoint**: all three stories independently functional; the Phase-4 substrate (transcript + agents + visibility scope + threads) is complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T039 [P] Log thread-match decisions + `coordinator_failover` events to observability (Langfuse/Sentry) with SLO alert on recovery over budget (§12.5, Constitution V)
- [ ] T040 [P] `session_event` archive: persist the Redis event log at session end for offline diagnosis (no raw audio); apply retention per workspace policy (§12.3, §12.5)
- [ ] T041 [P] CI assertion: `EXPLAIN ANALYZE` through the RLS path asserts "Partitions removed" for the new tables' tenant predicate (§12.9)
- [ ] T042 macOS code-signing + notarization for the Tauri app and signed auto-update channel (§12.3, §13)
- [ ] T043 [P] Storage-audit test `tests/integration/no-raw-audio.test.ts`: after a full session, no raw audio in Postgres / Redis / disk (SC-006, §12.3/R6)
- [ ] T044 Run `quickstart.md` V1–V11 on the two-client harness + a live two-person feel-pass (V1/V3/V4/V9 on real capture); confirm all pass

---

## Dependencies & Execution Order

### Phase dependencies
- **Setup (P1)**: after G1 clears — no other dependency.
- **Foundational (P2)**: depends on Setup — **BLOCKS all user stories**.
- **US1 (P3)**: after Foundational. **T023 additionally gated on G2** (AD-1 build spike).
- **US2 (P4)**: after Foundational; integrates with US1's session/merge but is independently testable.
- **US3 (P5)**: after Foundational; consumes the merged feed (US1) but independently testable.
- **Polish (P6)**: after the desired stories.

### Key intra-phase dependencies
- T007 → T008 → T009 (schema → migration → RLS guard).
- T010 (event log) → T014 (server), T022/T023 (ingest/merge), T037 (threads).
- T012 (ownership) → T014 (server), T027 (SSE fencing).
- T015 (STT iface) → T016 (failover test), T022 (worker ingest).
- T020 (capture) → T021 (WS client) → T022 (worker ingest) → T023 (merge).
- T032 (visibility) → T033 (agents), T034 (lifecycle).
- T036 (router score) → T037 (threads) → T038 (thread SSE).

### Parallel opportunities
- All Setup tasks T001–T006 are [P].
- In Foundational: T009, T011, T013, T015, T016 are [P] (distinct files) once their deps land.
- US1 tests T017–T019 run in parallel; T024/T025 [P] alongside the capture chain.
- US2 tests T030–T031 in parallel; US3 test T035 standalone.
- Polish: T039, T040, T041, T043 are [P].

---

## Implementation strategy

### MVP first (US1 only)
1. G1 clears → Phase 1 Setup.
2. Phase 2 Foundational (blocks everything).
3. G2 clears (AD-1 spike) → Phase 3 US1 incl. T023 merge.
4. **STOP and VALIDATE**: two people pair → one correctly-attributed transcript (quickstart V1–V5, V9).
5. Demo the MVP.

### Incremental delivery
- +US2 → agents on the feed + visibility scope (V4, V8) → demo.
- +US3 → open-thread tracking (V11) → demo.
- Polish → recovery/failover/storage-audit hardening (V6, V7, V10) → Phase-4-ready.

---

## Notes
- [P] = different files, no incomplete-task dependency. [Story] maps each task to a user story.
- Verify tests fail before implementing. Commit after each task or logical group.
- **Strictly plumbing**: if a task starts to require a gate/card/nudge/Decision-Record, it is Phase 4 —
  stop and defer (FR-023/FR-026).
- Every task traces to a PRD ID (F-/G-/R-/§/CX/AD) per Constitution I.
- The two PRD-deferred heavy mechanisms (continuous semantic sequencer, warm-standby Coordinator
  shards, §12.5) are **out of scope** here.
