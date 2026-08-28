# Architecture — FalconAI Phase 1 (Context Layer)

A map of the monorepo and how a request/artifact flows through it. Product intent lives in
[`PRD.md`](./PRD.md); the phased plan in PRD §17; the spec in
[`specs/001-context-layer/`](./specs/001-context-layer/). This file is the *code* orientation.

## Two deployables, seven libraries

```
apps/
  web      Next.js 15 (App Router) — dashboard pages + API route handlers. Vercel target.
  worker   BullMQ workers + poll scheduler. Fly.io target. The stateful sync/index/digest engine.

packages/
  db            Drizzle schema + the isolation spine: RLS + hash-partitioning + withTenant().
  core          Business logic: ingest/index, retrieve(), digest, decision search. No I/O of its own.
  integrations  Source adapters (GitHub/Linear/Jira) → a common ArtifactInput shape + ACL tags.
  llm           Cross-vendor ChatProvider (Claude Haiku) + EmbeddingProvider (voyage-code-4) + rerank.
  secrets       Envelope-encrypted OAuth token store. NEVER the app DB (R26); app holds secret_ref.
  queue         Lazy BullMQ queue getters shared by web + worker (no Redis connect at build time).
  config        One zod-validated env schema per slice; fail fast on missing/blank secrets.
  evals         recall@k bake-off harness (voyage-code-4 vs voyage-4-large) — the embedding decision.
```

## The load-bearing invariant: tenant isolation

Every tenant table carries `workspace_id`. Two mechanisms, defense in depth:

1. **RLS is the correctness floor.** `packages/db/src/tenant.ts` `withTenant(workspaceId, fn)` is the
   ONLY sanctioned path to tenant data. It opens a transaction, `set_config('app.workspace_id', …, true)`,
   and asserts it stuck. The app connects as a **non-superuser** role under **FORCE ROW LEVEL
   SECURITY** with a fail-closed policy (`current_setting('app.workspace_id', true)` — no context →
   zero rows). Requires the **transaction-mode** pooler so `SET LOCAL` survives.
2. **Hash-partitioning by `workspace_id`** on `artifact` / `artifact_chunk` / `decision_record` for
   pruning + blast-radius. Partitioning + RLS live in `packages/db/drizzle/0001_init.sql` (Drizzle
   can't express them); `schema.ts` is the typed query surface.

The guard tests in `tests/integration/` (isolation, ACL, partition-prune, fail-closed) run in CI on
a real pgvector container — SC-003 is blocker-class.

## Data flow (connect → retrievable)

```
Connect (web)                Sync + index (worker)                 Retrieve (web → core)
─────────────                ─────────────────────                 ─────────────────────
/api/integrations/<p>/  ──▶  sync-<p> job: adapter.listChanged ──▶ POST /api/retrieval
  connect + callback           → upsertArtifact (withTenant)          → core.retrieve():
  → SecretStore.put            → enqueue index-artifact                 withTenant + ACL filter
  → connection(secret_ref)   index job: chunk → embed (voyage)          + embedding_model filter
  → enqueue sync               → artifact_chunk(vector 1024)            + provenance + honest
webhook (near-real-time)     poll-backfill (30-day reconcile)           degraded flags
  → enqueue cursored sync    generate-digest (nightly, Haiku)
```

## Non-negotiables enforced in code (not just prompts)

- **Provenance-gated retrieval** — `retrieve()` returns only real, ACL-checked artifacts with an
  `externalRef` to cite; stale/disconnected sources surface as `degraded`, never silently.
- **No token in the app DB** — connections store `secret_ref` only; a CI job fails the build if any
  column looks like a raw token holder (R26).
- **CSRF on connect** — GitHub + Linear OAuth callbacks verify a single-use `state` nonce.
- **Embedding space is versioned** — `embedding_model` + `embedding_version` per row so the space can
  migrate; retrieval filters on the current model.

## What Phase 1 is NOT

No audio, VAD, STT, pairing, sessions, participant agents, Coordinator, or mediation cards. Those are
later phases (PRD §17). This layer is the moat the card-quality gate and the Wizard-of-Oz test depend on.
