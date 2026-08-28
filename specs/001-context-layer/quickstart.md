# Quickstart & Validation: Context Layer (Phase 1)

**Feature**: `specs/001-context-layer`. How to run the two deployables locally and validate the
spec's acceptance scenarios (US1–US3) and the blocker-class guarantees (SC-003 isolation,
SC-004 provenance). This is a run/validation guide — implementation lives in `tasks.md`.

## Prerequisites

- Node.js 24, pnpm, Docker (for Testcontainers + local Postgres).
- Supabase project with `pgvector` ≥ 0.8 (the existing `fpjauxowahtqaviyjfpy` project), using
  the **transaction-mode** pooler connection string.
- Redis (Upstash) for BullMQ.
- A GitHub App (repo-scoped) + its webhook secret; a Linear OAuth app.
- Voyage API key (`voyage-code-4`), Anthropic API key (Claude Haiku, pinned).
- A secrets store (Infisical self-hosted or a cloud Secrets Manager) — see `research.md` D3.
- Langfuse project (LLM call logging). Sentry/PostHog optional locally.

## Env (never commit real secrets; publishable/anon keys only in client code)

```
DATABASE_URL=            # Supabase transaction-mode pooler URL
REDIS_URL=
GITHUB_APP_ID= GITHUB_APP_PRIVATE_KEY= GITHUB_WEBHOOK_SECRET=
LINEAR_CLIENT_ID= LINEAR_CLIENT_SECRET=
VOYAGE_API_KEY= ANTHROPIC_API_KEY=
SECRETS_STORE_URL= SECRETS_STORE_TOKEN=
LANGFUSE_PUBLIC_KEY= LANGFUSE_SECRET_KEY=
AUTH_SECRET=
```

## Setup

```bash
pnpm install
# migrate runs psql against $DATABASE_URL — psql must be on PATH and DATABASE_URL exported into
# the shell (psql does NOT read .env). e.g.  export DATABASE_URL=$(grep ^DATABASE_URL .env | cut -d= -f2-)
pnpm --filter @falcon/db migrate     # schema + RLS policies + hash partitions
pnpm --filter @falcon/db seed        # NOT YET IMPLEMENTED (tracked in TODOS) — seed a test
                                     # workspace, two users, one shared + one private repo by hand for now
```

## Run

```bash
pnpm --filter @falcon/web dev        # dashboard + API (Vercel target)  → http://localhost:3000
pnpm --filter @falcon/worker dev     # BullMQ workers + poll scheduler (Fly.io target)
```

## Validate the acceptance scenarios

**US1 — connect + index + retrieve, access-safe (P1)**
1. Sign in, connect the GitHub App to a repo with ≥ 30 days of PRs.
2. Watch `/integrations` show `active` + a `lastSyncedAt`. Within ~10 min (SC-001) the initial
   sync completes.
3. `POST /api/retrieval { query: "auth work", k: 8 }` → returns the user's real PRs/commits with
   `externalRef` provenance (SC-004).
4. Merge a PR → within ~5 min (SC-002) it is retrievable without waiting for the poll.

**SC-003 — isolation (blocker-class, must pass in CI)**
- Integration test: seed workspace A and workspace B; retrieve in A with a query crafted to match
  B's artifacts → **zero** B items. Retrieve as a user without access to a private repo → that
  repo's artifacts never appear.
- `EXPLAIN (ANALYZE)` on the ANN query through the RLS path asserts `Partitions removed` (not a
  literal id). Fails the build if pruning regresses.
- Pooling check: confirm transaction-mode; a session-mode connection must fail the tenant-context
  assertion (guards against cross-request tenant bleed).

**US2 — Work Digest / trust valve (P2)**
1. After sync, the nightly `generate-digest` job (or a manual trigger) writes `generated_text`.
2. `GET /api/me/digest` shows an accurate summary; a user with no activity shows an honest empty
   state (no fabricated work).
3. `PUT /api/me/digest { text }` → `effectiveText` becomes the edit and persists (FR-010).

**US3 — Linear + Decision Index (P3)**
1. Connect Linear → issues/estimates/comments index under the same ACL rules.
2. Seed decision records in all three states → `GET /api/decisions?q=…` returns confirmed-only,
   recency-ranked, superseded never shown as current, old ones flagged (SC-008).

## Provider / eval checks

- **(NOT YET IMPLEMENTED — `packages/evals` doesn't exist yet; tracked in TODOS/START-HERE §4)**
  `pnpm --filter @falcon/evals recall` will run the recall@k harness (`voyage-code-4` vs
  `voyage-4-large`, ± `rerank-2.5`) to settle the embedding choice (research D6). This harness is
  also the card-quality gate instrument for later phases.
- Confirm every digest generation appears in Langfuse with its inputs (FR-015) and a pinned model.

## Done when

All US1–US3 scenarios pass, SC-003 isolation + partition-prune tests are green in CI, and no
OAuth token value exists in any app-DB column (grep + a schema check in CI).
