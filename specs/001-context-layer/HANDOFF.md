# Handoff: Context Layer (Phase 1) — cold-start resume guide

A fresh session (or another dev) can resume from the repo alone. The reasoning lives in the
committed docs, not in any chat.

## Read these first (the "why")
- `PRD.md` (v2.7), `.specify/memory/constitution.md` — product + non-negotiables.
- `reviews/` — the decision record (architecture-review, review-test-product, ceo-review, README).
- `specs/001-context-layer/` — `spec.md` → `plan.md` → `research.md` → `data-model.md` →
  `contracts/` → `tasks.md`. **tasks.md is the build list; resume from the first unchecked task.**

## What is built AND validated (typecheck-green here)
- **Monorepo scaffold**: pnpm workspaces + Turborepo, strict TS, `type: module`, deduped deps
  (pnpm overrides pin drizzle-orm 0.36.4 + postgres 3.4.5). `pnpm install` resolves; lockfile committed.
- **`packages/db` — the isolation spine** (`pnpm --filter @falcon/db typecheck` → clean):
  - `drizzle/0001_init.sql` — full Phase-1 schema; artifact/artifact_chunk/decision_record
    HASH-PARTITIONED by workspace_id; RLS ENABLED+FORCED with a fail-closed policy on every
    tenant data table.
  - `src/tenant.ts` — `createDb(url)` + `withTenant()` (sets app.workspace_id via set_config,
    asserts it stuck). The only path to tenant data.
  - `src/schema.ts` — Drizzle tables (vector(1024) + model/version + trust_tier).
- **Invariant tests** (`pnpm exec tsc -p tsconfig.tests.json` → clean): `tests/integration/`
  isolation, acl, partition-prune, pooling (fail-closed) + `tests/support/pg.ts` (Testcontainers
  harness that creates a NON-SUPERUSER role so RLS actually enforces).

## Now built (whole context layer — see tasks.md "Implementation status")
The full stack is written and **typecheck-clean** (`pnpm -r typecheck` + `tsc -p tsconfig.tests.json`):
`packages/{db,config,secrets,llm,integrations,core,queue}` and `apps/{worker,web}` — sync/index/
digest/poll jobs, `retrieve()`, digest, decision search, Auth.js, the dashboard, the GitHub
connect flow, and the HMAC-verified webhook.

## What IS proven vs still unrun
- **Proven in CI** (`.github/workflows/ci.yml`, green on `cc4b25b`): the migration applies to a real
  pgvector Postgres, and the blocker-class guard suite passes on a non-superuser role — isolation,
  ACL, fail-closed pooling, and partition-prune (runtime "Subplans Removed", scans exactly 1 of 16).
  Plus full typecheck + the no-token-in-DB gate. SC-003 tenant isolation is no longer just asserted.
- **Still unrun (needs your machine + creds):** the live app flow — sign in, connect a real
  GitHub/Linear/Jira source, sync, embed via Voyage, retrieve. That path uses external APIs CI can't
  reach. Run it via the quickstart (T044) to close it.
- **Remaining gaps (tasks.md):** T018/T019 (retrieval-provenance + github-sync integration tests),
  T043 Playwright smoke — writable, best against a live DB. Sentry/PostHog, connect flows, seeding,
  evals, CI gates, and rate limiting are now DONE (see tasks.md "Implementation status").

## First-run sequence (on a machine with Docker + creds)
1. `corepack enable && pnpm install`
2. `cp .env.example .env` and fill `DATABASE_URL` (Supabase **transaction** pooler, port 6543) etc.
3. Apply the schema: `pnpm --filter @falcon/db migrate` (psql), or wire drizzle-kit.
4. Create the app role (non-superuser, no BYPASSRLS) — grants are in `tests/support/pg.ts`.
5. Run the invariant tests (Docker required): `pnpm test:integration`. Expect the isolation,
   partition-prune, and fail-closed tests to pass; if partition-prune fails, check the plan text
   assertion against your Postgres version output.

## Notes
- Dependency versions are locked in `pnpm-lock.yaml` but were selected without a full compat
  sweep — run `pnpm outdated` and reconcile before relying on them in production.
- The concrete secrets-store pick (research D3) is still open and is blocker-class (R26) —
  resolve before the GitHub connect flow (T022) ships.
- External-clock items unrelated to code: send `reviews/legal-brief-capture-consent.md`, start
  WoZ recruiting, run the latency measurement (OV-3).
