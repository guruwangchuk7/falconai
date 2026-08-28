# Implementation Plan: Context Layer (Phase 1 — the moat)

**Branch**: `001-context-layer` | **Date**: 2026-08-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-context-layer/spec.md`

## Summary

Build the architecture-independent context layer: sync each user's GitHub/Linear/Jira work on a
rolling 30-day window, index it for semantic retrieval with per-user/per-repo ACLs under
DB-enforced tenant isolation, maintain an editable Personal Work Digest and a searchable Org
Decision Index, and expose a minimal dashboard. No audio, pairing, agents, or coordinator.
This is PRD §17 Phase 1 and the foundation the card-quality gate and Wizard-of-Oz test depend on.

## Technical Context

**Language/Version**: TypeScript (Node.js 24, strict mode) end to end.

**Primary Dependencies**: Next.js 15 (App Router) + Tailwind + shadcn/ui (dashboard);
BullMQ (jobs); Drizzle ORM; Octokit (GitHub App), Linear SDK, Jira REST; Voyage `voyage-code-4`
embeddings + `rerank-2.5`; Anthropic Claude Haiku (pinned) behind a provider interface;
Langfuse + Sentry + PostHog.

**Storage**: Supabase Postgres + pgvector (≥ 0.8). Redis (Upstash) for BullMQ + sync cursors.
OAuth tokens in a dedicated secrets store (NOT the app DB), per-tenant envelope encryption.

**Testing**: Vitest (unit), Testcontainers-backed Postgres for integration (RLS/partition
tests run against real Postgres, never mocked), Playwright for the dashboard smoke path.

**Target Platform**: Vercel (Next.js) + Fly.io (Node worker). Postgres/Redis managed.

**Project Type**: Web application (Next.js full-stack) + a background worker service. Monorepo.

**Performance Goals**: initial GitHub sync retrievable ≤ 10 min (SC-001); merged PR retrievable
≤ 5 min via webhook path (SC-002); retrieval p95 within the card-quality latency budget once the
agent path exists (bounded now by pgvector partition-pruned ANN).

**Constraints**: tenant isolation is blocker-class (zero cross-tenant leak, SC-003); every
retrieval result provenance-checked (SC-004); sync failures degrade to marked-stale, never
silently-wrong (SC-007). 30-day rolling window bounds sync + retrieval.

**Scale/Scope**: Phase-1 target is pilot scale (tens of workspaces, hundreds of users); the
schema and RLS/partitioning are designed so the PRD's 500-session / ~4,000-agent target
(§12.10) is reachable without a data-layer rewrite.

### Resolved decisions (from the input; detail in research.md)

- **Supabase over Neon** — already provisioned (the waitlist project), pgvector built in.
- **Auth.js over Clerk** — no per-MAU cost, which matters for the capped-free wedge (D2); more
  setup than Clerk, accepted.
- **Next.js route handlers for the dashboard API + webhook receivers; a dedicated Node worker
  (BullMQ) on Fly.io for sync/index/digest.** Phase 1 is batch-only, so no Fastify yet —
  Fastify + WebSocket arrive with the realtime core in Phase 3 (PRD §6.3). This keeps Phase 1
  to two deployables, not three.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. PRD is law, traceability mandatory | Every FR in the spec traces to a PRD ID; plan adds no feature the PRD doesn't sanction; this is Phase 1 per §17. | PASS |
| II. Grounded or silent | Retrieval returns only real, ACL-checked artifacts (FR-017); results carry provenance (artifact ID + source). No fabrication path. No publishing in Phase 1. | PASS |
| III. Security boundaries are code | Tenant isolation via Postgres RLS + hash-partitioning by `workspace_id` (FR-007); OAuth tokens in a dedicated secrets store with per-tenant envelope encryption (FR-014); trust tiers on chunks at ingestion (FR-008). Enforced in DB + secrets layer, not prose. | PASS |
| IV. Honest degradation over confident wrongness | Sync failure → marked-stale, not served-wrong (FR-013); `last_synced` on every artifact; bounded sync with cursors + backoff (FR-005). | PASS |
| V. Measure judgments, pin models | Digest generation logged to Langfuse with inputs (FR-015); Claude Haiku pinned (never `-latest`); LLM + embeddings behind provider interfaces for canary swap. | PASS |
| Product invariants | Decision lifecycle: only confirmed records retrievable (FR-012). Text-only / audio / pairing N/A (out of scope). Dashboard reuses the Quiet Voltage system. | PASS |
| Phased roadmap + setup gate | This is Phase 1 (first phase); owner explicitly lifted the setup gate for this feature. | PASS |

**Result: PASS, no violations.** Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-context-layer/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (retrieval interface, REST, job + provider contracts)
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

Monorepo via pnpm workspaces + Turborepo. Two deployables (`apps/web` → Vercel,
`apps/worker` → Fly.io); shared logic in `packages/`.

```text
apps/
├── web/                 # Next.js 15 App Router — dashboard + API route handlers
│   ├── app/
│   │   ├── (dashboard)/integrations/    # §10 /integrations — connection + sync status
│   │   ├── (dashboard)/me/digest/       # §10 /me/digest — editable Work Digest (trust valve)
│   │   ├── (dashboard)/decisions/       # §10 /decisions — Org Decision Index search
│   │   └── api/
│   │       ├── auth/                     # Auth.js
│   │       ├── webhooks/{github,linear}/ # receive → enqueue (BullMQ)
│   │       └── retrieval/                # internal retrieval endpoint (eval + later phases)
│   └── tests/                            # Playwright smoke
└── worker/              # Node 24 — BullMQ workers + poll scheduler (Fly.io)
    └── src/jobs/        # sync-github, sync-linear, index-artifact, generate-digest, poll-backfill

packages/
├── db/                  # Drizzle schema, migrations, RLS policies, partition DDL, tenant-context helper
├── core/                # domain: artifacts, ACL tags, retrieval, digest assembly, decision index
├── integrations/        # github / linear / jira adapters (sync mappers + webhook parsers + cursors)
├── llm/                 # provider interface: chat (Claude Haiku pinned), embeddings (voyage-code-4), rerank
├── secrets/             # dedicated secrets-store client: envelope-encrypted OAuth token get/put/rotate
└── evals/               # recall@k harness (voyage-code-4 vs voyage-4-large; +rerank-2.5)

tests/
├── contract/            # retrieval interface, webhook payloads, provider interface
├── integration/         # RLS + partition-prune (real Postgres via Testcontainers), sync end-to-end
└── unit/
```

**Structure Decision**: Web-application monorepo. `apps/web` (Vercel) owns the dashboard, auth,
webhook receipt, and the internal retrieval endpoint; `apps/worker` (Fly.io) owns the
long-running sync/index/digest jobs and the poll scheduler. All tenant-scoped data access goes
through `packages/db`'s tenant-context helper so RLS is never bypassed. This is the smallest
structure that separates the serverless dashboard from the persistent job runner while sharing
one schema and one domain core.

## Complexity Tracking

> No constitution violations. Section intentionally empty.
