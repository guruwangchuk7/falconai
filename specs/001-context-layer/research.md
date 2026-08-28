# Phase 0 Research: Context Layer

**Feature**: `specs/001-context-layer` | **Date**: 2026-08-28

Decisions resolve the plan's Technical Context unknowns and the three items flagged for the plan.
Each traces to the PRD, the constitution, and this session's review dossier
(`reviews/architecture-review.md` A1–A8, `reviews/review-test-product.md` OV/T/P items).

---

## D1 — Primary datastore: Supabase Postgres + pgvector (over Neon)

- **Decision**: Supabase Postgres with the `pgvector` extension (≥ 0.8), Drizzle ORM.
- **Rationale**: The waitlist project is already provisioned on Supabase (`fpjauxowahtqaviyjfpy`), pgvector ships built in, and RLS is first-class. PRD §13 allows "Neon/Supabase"; using what exists removes an ops surface. Supabase also gives Auth-adjacent primitives if needed later.
- **Alternatives**: Neon (great branching, but a second vendor to stand up); a dedicated vector store (rejected in review A2 — its namespace isolation is app-enforced, the exact property §12.9 exists to eliminate).

## D2 — Tenant isolation: RLS floor + hash-partition by `workspace_id` (review A2)

- **Decision**: Postgres RLS is the correctness boundary; hash-partitioning by `workspace_id` (32–64 buckets, LIST partitions for whale tenants later) carries performance. pgvector ≥ 0.8 for iterative index scans. Per-request tenant context via `SET LOCAL app.workspace_id` inside an explicit transaction; policies `USING (workspace_id = current_setting('app.workspace_id')::uuid)`. App DB role: no `BYPASSRLS`, not the table owner, `FORCE ROW LEVEL SECURITY` on every tenant table.
- **Rationale**: RLS predicates fight the ANN index (post-filter kills recall/p95 at scale); partition-pruning makes the tenant filter a partition selection, and small partitions can use exact kNN (100% recall) with HNSW only where size warrants. A missing app-layer predicate cannot leak (blocker-class R25). This is the A2 ruling verbatim.
- **CI assertion**: `EXPLAIN (ANALYZE)` through the real RLS path must show `Partitions removed`, NOT a literal workspace id — the qual is `STABLE`, so pruning is runtime and would degrade silently. Ship this as a test (SC-003 depends on it).
- **Pooling caveat**: Supabase pooling must be **transaction mode** (Supavisor/pgBouncer) so `SET LOCAL` scopes to the transaction. Session-mode pooling would leak tenant context across requests — a correctness hazard. The tenant-context helper in `packages/db` wraps every query in a transaction that sets and asserts `app.workspace_id`.
- **Alternatives**: app-layer filtering only (rejected — one missed predicate = leak); schema-per-tenant (heavy at pilot scale); RLS without partitioning (rejected — the ANN post-filter tax).

## D3 — Secrets store for OAuth tokens (R26, blocker-class — constitution III)

- **Decision**: OAuth tokens live in a **dedicated secrets store, never the app DB**, under per-tenant envelope encryption. Default: self-hosted **Infisical** on Fly.io (OSS, per-tenant secret paths, accessed only by `apps/worker` via a service credential); managed alternative: a cloud provider Secrets Manager + KMS. The app DB stores only a reference (provider + connection id), never the token.
- **Rationale**: Falcon concentrates GitHub/Linear/Jira tokens across customers — a breach is a cross-tenant catastrophe larger than transcript exposure (R26). Supabase Vault (pgsodium) is rejected because it lives IN the app database, which the constitution explicitly forbids ("never the app DB").
- **Open**: the concrete pick (Infisical vs cloud Secrets Manager) is security-critical; confirm before the GitHub connect flow ships. Envelope encryption: per-tenant KEK in a KMS, per-token DEK, only ciphertext at rest.
- **Alternatives**: encrypted column in the app DB (violates constitution III / R26); plaintext env vars (never).

## D4 — Auth: Auth.js (over Clerk)

- **Decision**: Auth.js (NextAuth) for sign-up / workspace membership / sessions.
- **Rationale**: no per-MAU cost, which matters for the capped-free wedge (CEO review D2 — a free user already costs real COGS; per-seat auth pricing would stack on top). Open, self-hosted, native to Next.js.
- **Alternatives**: Clerk (faster to build, nicer UI, but per-MAU pricing taxes the free tier); roll-your-own (rejected — auth is not where innovation tokens go, ETHOS Layer 1).

## D5 — Runtime split: Next.js route handlers + a Node worker (Fastify deferred to Phase 3)

- **Decision**: `apps/web` (Vercel) serves the dashboard, Auth.js, webhook receivers (enqueue only), and the internal retrieval endpoint via Next.js route handlers. `apps/worker` (Fly.io) runs BullMQ workers + the poll scheduler for sync/index/digest. No Fastify in Phase 1.
- **Rationale**: Phase 1 is batch-only — there is no realtime audio/WebSocket, which is the reason PRD §6.3 specifies Fastify-on-Fly. Standing up Fastify now adds a third deployable for no Phase-1 benefit. Fastify + the session worker arrive with the realtime core in Phase 3.
- **Alternatives**: all-Fastify (premature; duplicates Next's API layer); all-serverless including jobs (rejected — sync/index/digest are long-running; serverless timeouts + no persistent scheduler).

## D6 — Embeddings: voyage-code-4 now, final choice gated on a recall@k eval (review A4)

- **Decision**: ship `voyage-code-4` (1024-dim); store `embedding_model` + `embedding_version` per row; make the embedding space part of the partition key so a cross-model query can't silently mix spaces; dual-write + shadow-read make a model swap a background re-embed, not a migration.
- **Rationale (and the caveat)**: the corpus is mostly prose *about* code (PR descriptions, tickets, review comments), not raw code — so `voyage-4-large` may win. Settle it with a `packages/evals` recall@k harness on a labeled set (this doubles as the card-quality gate instrument). Add `rerank-2.5` to the eval (often more precision than switching embedding models, at a latency cost to weigh against the agent budget later).
- **Alternatives**: OpenAI `text-embedding-3-large` (3072-dim, costlier at scale, not code-tuned); `-3-small` (1536, weakest — poor trade for the moat). Never hardcode the model name in the schema (A4).

## D7 — GitHub integration: GitHub App, repo-scoped (over OAuth app)

- **Decision**: a GitHub **App** with repo-scoped installation permissions (PRD F1.4); Octokit with installation tokens; App webhooks for active updates.
- **Rationale**: finer-grained, per-repo, org-installable, first-class webhooks, short-lived installation tokens (smaller blast radius than a long-lived user OAuth token). Matches "least-scope grants" (§12.9).
- **Alternatives**: OAuth app (coarser scopes, longer-lived tokens); PAT (unacceptable for a product).

## D8 — Sync model: webhook-for-active + poll-for-historical (AD-4, §15.1)

- **Decision**: GitHub + Linear get webhooks in Phase 1 for near-real-time active updates; a scheduled poll backfills the 30-day window and reconciles missed events. Jira is poll-first (webhooks later). Every source has a persisted sync cursor and exponential backoff; every artifact carries `last_synced`; a failed sync marks data stale, never serves it as current (FR-013, honest degradation).
- **Rationale**: resolves the F2.1 "30-day window" vs worked-example same-day-freshness tension exactly as §15.1 specifies; webhooks are what make "PR #482 merged Tuesday" surface in a Tuesday meeting.
- **Alternatives**: poll-only (misses same-day freshness — breaks the core value); webhook-only (misses historical backfill + is lossy on downtime).

## D9 — Chunking, indexing, trust tiers (F2.2, F7.2)

- **Decision**: chunk per artifact with type-aware templates (PR: title + body + diff summary + review threads; issue: title + body + comments; commit: message + touched paths). Each chunk row carries `workspace_id`, owner, repo/project, ACL tags, and a `trust_tier` set at ingestion (team-authored = trusted; commit diff = mid; PR/ticket comment bodies = untrusted). Downstream consumers keep untrusted tiers out of instruction position.
- **Rationale**: the trust tier is a retrieval-layer schema decision that is cheap now and painful to retrofit (review A3/T3); shipping it in Phase 1 also gives Phase 4 a benign-traffic baseline for the injection eval.
- **Alternatives**: binary trusted/untrusted flag (A3 rejected — make it a tier); no tiering (leaves the Phase-4 injection defense with nowhere to stand).

## D10 — LLM provider interface for the Personal Work Digest (constitution V, review OV-11)

- **Decision**: `packages/llm` exposes a thin, **cross-vendor** provider interface (chat + embeddings + rerank). Phase 1 uses Claude Haiku (pinned version, never `-latest`) for digest generation; every call is logged to Langfuse with inputs.
- **Rationale**: the judgment layer must not be single-vendor (OV-11); pinning + logging makes a model swap a canary against the eval, not a surprise (§12.8, R22). Digest is the only LLM judgment in Phase 1, so it's the natural place to prove the interface + eval loop.
- **Alternatives**: call the Anthropic SDK directly (rejected — no swap path, no drift monitor); no logging (rejected — can't tune what you can't measure, R21).

## D11 — Monorepo tooling

- **Decision**: pnpm workspaces + Turborepo; TypeScript strict; Vitest + Testcontainers (real Postgres for RLS/partition tests) + Playwright (dashboard smoke).
- **Rationale**: standard for Next.js + shared packages; RLS/partition correctness (SC-003) must be tested against real Postgres, never mocked.
- **Alternatives**: Nx (heavier); single package (rejected — two deployables need shared packages).

---

## Deferred / flagged (not Phase 1)

- Long-horizon Decision Index growth/tiering (PRD Open Q4) — 30-day window bounds Phase 1.
- Erasure/tombstoning of the embedded Decision Index (review OV-10) — design before the index compounds; noted, not built here.
- Warm-standby / semantic sequencer / Coordinator failover (§12.5) — later phases.
- Final embedding model + rerank latency tradeoff — settled by the D6 eval before the agent path (Phase 2+) consumes retrieval on a latency budget.
