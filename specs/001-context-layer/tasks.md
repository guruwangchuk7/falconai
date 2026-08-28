---
description: "Task list — Context Layer (Phase 1)"
---

# Tasks: Context Layer (Phase 1 — the moat)

**Input**: Design documents from `specs/001-context-layer/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED. The spec's success criteria are tested guarantees (SC-003 tenant isolation
and SC-004 provenance are blocker-class), and the constitution / owner preference make tests
non-negotiable. Isolation, ACL, partition-prune, provenance, and decision-lifecycle tests are
written before their implementation.

## Format: `[ID] [P?] [Story] Description with file path`

- **[P]**: parallelizable (different files, no incomplete-dependency)
- **[Story]**: US1 / US2 / US3 (setup/foundational/polish carry no story label)

---

## Phase 1: Setup (shared infrastructure)

- [ ] T001 Scaffold the pnpm-workspaces + Turborepo monorepo (`apps/web`, `apps/worker`, `packages/{db,core,integrations,llm,secrets,evals,config}`) with root `pnpm-workspace.yaml`, `turbo.json`, strict `tsconfig.base.json`
- [ ] T002 [P] Initialize `apps/web` as Next.js 15 (App Router, TypeScript strict, Tailwind, shadcn/ui + Radix); wire the Quiet Voltage tokens from `design.md` into `globals.css`
- [ ] T003 [P] Initialize `apps/worker` as a Node 24 TypeScript service (BullMQ entrypoint, graceful shutdown)
- [ ] T004 [P] Configure ESLint + Prettier + Vitest at root; add `packages/config` with a zod-validated env schema (fail fast on missing/blank secrets)
- [ ] T005 [P] CI skeleton (GitHub Actions): typecheck, lint, unit + integration test jobs (Postgres service), placeholder for the partition-prune + no-token-in-DB gates (see T043)

---

## Phase 2: Foundational (blocking prerequisites — no user story starts until done)

**⚠️ CRITICAL: the isolation spine lives here.**

- [ ] T006 `packages/db`: Drizzle + Supabase **transaction-mode** pooler connection; a `withTenant(workspaceId, fn)` helper that opens a txn, runs `set local app.workspace_id`, and asserts it (the ONLY path to tenant data)
- [ ] T007 `packages/db`: schema for `workspace`, `user`, `membership` (foundational entities per data-model.md) + Drizzle migrations
- [ ] T008 `packages/db`: enable + FORCE RLS on every tenant table; create the app DB role with **no `BYPASSRLS`**, not table owner; policies `using (workspace_id = current_setting('app.workspace_id')::uuid)`
- [ ] T009 [P] Integration test harness: Testcontainers Postgres with `pgvector` ≥ 0.8; helper to seed workspaces/users/repos (real DB, never mocked)
- [ ] T010 `apps/web`: Auth.js (sign up, session) + resolve active `membership` → the workspace context every request uses
- [ ] T011 [P] `packages/secrets`: `SecretStore` interface + dedicated-store client (Infisical/cloud SM per research D3) with per-tenant envelope encryption; `put/get/rotate/revoke`; app DB stores only `secret_ref` (R26)
- [ ] T012 [P] `packages/llm`: `ChatProvider` (Claude Haiku, **pinned** version) + `EmbeddingProvider` (`voyage-code-4`, dim 1024, version recorded) + `RerankProvider` (`rerank-2.5`) behind cross-vendor interfaces; Langfuse logging on every chat call
- [ ] T013 `apps/worker`: BullMQ queues + Redis (Upstash) connection; bounded concurrency + dead-letter; all jobs run through `withTenant`
- [ ] T014 [P] Observability: Sentry (web + worker) and PostHog (web) minimal wiring

**Checkpoint**: isolation helper + auth + secrets + provider interfaces ready.

---

## Phase 3: User Story 1 — connect + index + retrieve, access-safe (P1) 🎯 MVP

**Goal**: Connect GitHub → recent work indexed → retrievable, with tenant isolation + ACLs.
**Independent test**: quickstart US1 + SC-003/SC-004 tests green.

### Tests (write first, must fail)

- [ ] T015 [P] [US1] Integration test — tenant isolation: seed workspaces A & B; a query in A crafted to match B returns **zero** B items (`tests/integration/isolation.test.ts`, SC-003)
- [ ] T016 [P] [US1] Integration test — ACL: a private-repo artifact is never returned to a non-member (`tests/integration/acl.test.ts`, SC-003)
- [ ] T017 [P] [US1] Integration test — partition prune: `EXPLAIN (ANALYZE)` through the RLS path asserts `Partitions removed` (`tests/integration/partition-prune.test.ts`)
- [ ] T018 [P] [US1] Contract test — `retrieve()` returns only real, provenance-bearing items; no fabrication (`tests/contract/retrieval.test.ts`, SC-004)
- [ ] T019 [P] [US1] Integration test — GitHub sync → artifact indexed → retrievable within budget (`tests/integration/sync-github.test.ts`, SC-001/002)

### Implementation

- [ ] T020 [P] [US1] `packages/db`: `artifact` + `artifact_chunk` tables **hash-partitioned by `workspace_id`**, `embedding vector(1024)` + `embedding_model`/`embedding_version` + `trust_tier`; per-partition vector index (exact kNN small / HNSW large); btree + gin indexes; RLS (data-model.md)
- [ ] T021 [P] [US1] `packages/integrations`: GitHub App adapter (Octokit) — `listChanged` (cursored, backoff), `parseWebhook` (sig verified by caller), `toArtifact` (sets `acl_tags` + `trust_tier`)
- [ ] T022 [US1] `apps/web`: GitHub App connect flow + callback → store token in `SecretStore`, persist `connection` with `secret_ref` only (`app/api/integrations/github/`)
- [ ] T023 [US1] `apps/web`: `POST /api/webhooks/github` — verify signature, enqueue `sync-github`, 202 (no inline DB writes)
- [ ] T024 [US1] `apps/worker`: `sync-github` job — fetch delta, upsert `artifact` (idempotent on `(workspace_id,source,external_ref)`), advance cursor, write `sync_run`, mark stale + `connection.status='error'` on failure
- [ ] T025 [US1] `apps/worker`: `index-artifact` job — type-aware chunking (`packages/core`), per-chunk `trust_tier`, embed via `voyage-code-4`, upsert `artifact_chunk` (records model/version)
- [ ] T026 [US1] `packages/core`: `retrieve()` per `contracts/retrieval.md` — `withTenant`, ACL filter on `acl_tags`, `embedding_model` filter, recency + provenance, `degraded` on stale/disconnected sources
- [ ] T027 [US1] `apps/web`: `POST /api/retrieval` internal endpoint (auth + membership scoped) returning `RetrieveResult`
- [ ] T028 [US1] `apps/web`: `/integrations` page — connection status, `lastSyncedAt`, staleness (§10, FR-016)
- [ ] T029 [US1] `apps/worker`: `poll-backfill` job + scheduler (30-day reconcile, catch missed webhooks)

**Checkpoint**: MVP — a workspace has a private, access-safe, retrievable index of its GitHub work.

---

## Phase 4: User Story 2 — Personal Work Digest / trust valve (P2)

**Goal**: An accurate, editable summary of what each user has been doing.
**Independent test**: quickstart US2 (generated + honest-empty + edit precedence).

### Tests

- [ ] T030 [P] [US2] Integration test — digest generates from synced work; no-activity → honest empty state; `edited_text` supersedes `generated_text` (`tests/integration/digest.test.ts`)

### Implementation

- [ ] T031 [P] [US2] `packages/db`: `work_digest` table + RLS (data-model.md)
- [ ] T032 [US2] `apps/worker`: `generate-digest` nightly job — assemble recent artifacts → Claude Haiku (pinned) → 800–1200-token summary; log to Langfuse with inputs; never overwrite `edited_text`; honest empty state
- [ ] T033 [US2] `apps/web`: `/me/digest` page + `GET/PUT /api/me/digest` — `effectiveText` = edit if present (FR-010, trust valve)

**Checkpoint**: US1 + US2 both work independently.

---

## Phase 5: User Story 3 — Linear/Jira + Org Decision Index (P3)

**Goal**: Broaden sources; searchable, lifecycle-correct decision memory.
**Independent test**: quickstart US3 (Linear indexed under ACL; decision search confirmed-only + freshness).

### Tests

- [ ] T034 [P] [US3] Integration test — Linear sync indexes issues/estimates/comments under the same ACL/isolation rules (`tests/integration/sync-linear.test.ts`)
- [ ] T035 [P] [US3] Integration test — Decision Index: confirmed-only, superseded never shown as current, freshness flag past horizon (`tests/integration/decisions.test.ts`, SC-008)

### Implementation

- [ ] T036 [P] [US3] `packages/integrations`: Linear adapter (webhook + poll) and Jira adapter (poll-first), mapping to the common artifact shape with `acl_tags` + `trust_tier`
- [ ] T037 [US3] `apps/web` + `apps/worker`: Linear/Jira connect flow, `POST /api/webhooks/linear`, `sync-linear`/`sync-jira` jobs (cursors, backoff, stale-marking)
- [ ] T038 [P] [US3] `packages/db`: `decision_record` table **hash-partitioned by `workspace_id`** (vector + model/version, status lifecycle, `supersedes_id`) + RLS
- [ ] T039 [US3] `packages/core` + `apps/web`: decision search (confirmed-only, recency-weighted, freshness flag) → `GET /api/decisions` + `/decisions` page
- [ ] T040 [US3] Decision Index seeding from a workspace's designated existing source if configured, else start empty (research D-assumption; confirm via `/speckit-clarify` before wiring a specific importer)

**Checkpoint**: all three stories independently functional.

---

## Phase 6: Polish & cross-cutting

- [ ] T041 [P] `packages/evals`: recall@k harness (`voyage-code-4` vs `voyage-4-large`, ± `rerank-2.5`) on a labeled set — settles the embedding choice and is the card-quality gate instrument (research D6)
- [ ] T042 CI gates: the partition-prune `EXPLAIN` assertion (T017) + a "no OAuth token value in any app-DB column" schema/grep check + the full RLS/ACL isolation suite must pass to merge
- [ ] T043 [P] Playwright smoke: sign up → connect GitHub → see digest → search decisions
- [ ] T044 Run `quickstart.md` end to end; confirm SC-001..SC-008
- [ ] T045 [P] Docs: update `README.md` (PRD now v2.7, repo map incl. `specs/`) and add an `apps/`/`packages/` architecture note
- [ ] T046 Security hardening: rate-limit connect + webhook endpoints; review secret handling; confirm transaction-mode pooling in all environments

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** → **Phase 2 (Foundational)** blocks everything. The `withTenant` helper (T006), RLS (T008), secrets (T011), and provider interfaces (T012) are hard prerequisites.
- **US1 (P1)** is the MVP; start after Phase 2. **US2 (P2)** and **US3 (P3)** depend only on Phase 2 and can run in parallel with each other after US1's shared pieces (artifact schema T020, retrieve T026) exist.
- Within a story: tests → schema/models → adapters/jobs → API/UI.
- **Polish** after the target stories.

### Parallel opportunities

- Setup: T002/T003/T004/T005 in parallel.
- Foundational: T009/T011/T012/T014 in parallel after T006–T008.
- US1 tests T015–T019 in parallel (all fail first).
- US2 and US3 can be built in parallel once US1's artifact schema + retrieve land.

## Implementation Strategy

- **MVP = Phase 1 + Phase 2 + Phase 3 (US1).** Stop and validate: SC-001/002 (freshness), SC-003 (isolation), SC-004 (provenance) green. This alone is a private, access-safe context index — the moat, and enough to make the card-quality / WoZ test fair.
- Then US2 (trust valve), then US3 (decision memory). Each is an independent, testable increment.
- Commit after each task or logical group. Do not proceed past the US1 checkpoint until the isolation + partition-prune tests are green — that guarantee is blocker-class.

## Summary

- **Total tasks**: 46 (T001–T046)
- **Per story**: Setup 5, Foundational 9, US1 15 (5 tests + 10 impl), US2 4 (1 test + 3 impl), US3 7 (2 tests + 5 impl), Polish 6
- **MVP scope**: US1 (T001–T029)
- **Blocker-class gates**: T015/T016/T017 (isolation + partition prune), T018 (provenance), T042 (CI enforcement)
