# Implementation Plan: Pairing — Shared, Correctly-Attributed Sessions

**Branch**: `004-pairing` | **Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-pairing/spec.md`

## Summary

Turn two independent Personal Falcons into one **shared, correctly-attributed meeting session**. This
is the Phase 3 substrate (PRD §17): a Tauri desktop app captures each person's *own* mic (VAD-gated,
raw audio never stored), streams it to a stateful **session worker** that merges the per-client
transcripts into one time-ordered feed with exact attribution *by construction*, provisions one
Participant Agent per human on top of the shipped Phase 1/2 retrieval+answer spine, computes the
`session_visibility_scope` ACL-intersection at pairing (F9.1a — the Phase-4 precondition), and tracks
Open Threads as event-sourced folds (CX-1). **Strictly plumbing: no intervention gates, no mediation
cards, no private nudges** — those are Phase 4. Human-visible output is the shared transcript only.

Technical approach: reuse the monorepo (`apps/*`, `packages/*`) and the Phase 1 context layer
(`@falcon/db` RLS, `@falcon/core` retrieval, `@falcon/integrations` calendars) and Phase 2 answer core
(`@falcon/core/answer`, `@falcon/llm`). Add a new **`apps/desktop`** (Tauri 2) and a stateful
**session worker** (Node 24 + Fastify, WebSocket in / SSE out) whose live state is event-sourced to
Redis Streams with lease + fencing-token ownership. Two pending architecture decisions are resolved
by spike in Phase 0 research: **AD-1** (clock sync → adopt server-arrival ordering, defer the full
subsystem) and **AD-2** (LangGraph → defer; in-worker async tasks suffice for Phase 3).

## Technical Context

**Language/Version**: TypeScript on Node.js 24 (session worker, web); Rust (Tauri 2 core, `cpal`
audio, Silero VAD via ONNX Runtime); React 19 (Tauri webview panel + Next.js dashboard).

**Primary Dependencies**: EXISTING workspace packages — `@falcon/db` (Drizzle + postgres.js, RLS via
`falcon_app`), `@falcon/core` (retrieve/answer/digest), `@falcon/llm` (Anthropic + Voyage),
`@falcon/queue` (BullMQ), `@falcon/integrations` (GitHub/Linear/**Google & Microsoft Calendar**),
`@falcon/secrets`, `@falcon/observability`. NEW — Fastify (session worker), `ws` (WebSocket),
Redis Streams (via existing Upstash client) for the event log, Deepgram Nova streaming SDK +
AssemblyAI failover behind a thin STT provider interface, Tauri 2 + `cpal` + `onnxruntime` (Silero
VAD) on the desktop side.

**Storage**: Postgres + pgvector (Supabase) — new tenant-scoped tables (`session`,
`session_membership`, `session_code`, `consent_pair`, `open_thread`, `session_event` archive,
`session_visibility_scope`), all RLS + FORCE, keyed on `workspace_id`. **Live** session state lives in
**Redis Streams** (event-sourced, §12.3); Postgres holds durable/finalized records. **Raw audio is
never persisted** anywhere — it exists only as an in-flight transcription stream (§12.3, R6).

**Testing**: Vitest (unit + integration guards on real Postgres via `tests/support/pg.ts`); a
Testcontainers Redis for event-sourcing/recovery tests; a **fault-injection shim** for the STT
circuit breaker (kill socket / inject latency / garble finals); Playwright for the panel; a
deterministic **two-client harness** that drives paired sessions without live audio (fake STT seam,
mirroring Phase 2's `FALCON_FAKE_LLM`).

**Target Platform**: desktop (macOS first — code-signing/notarization; Windows parity is Phase 6) +
Node services on Fly.io + browser dashboard. Panel UI shares React components across Tauri webview and
the Next.js dashboard.

**Project Type**: web + desktop (pnpm monorepo). New members: `apps/desktop` (Tauri) and
`apps/session-worker` (or `packages/session` consumed by `apps/worker`); see Structure Decision.

**Performance Goals** (Phase-3 slice of the §12.1 budget): mic→VAD→stream ~100ms; STT interim→final
~300ms; **merge + reorder buffer ~2s** (the price of merging independent clients); session-worker
recovery within the **§12.5 budget** (lease TTL ~2–3s + bounded replay); join-to-visible < 10s
(SC-003). No card/synthesis budget applies — Phase 3 publishes nothing.

**Constraints**: exact attribution by construction (each client transcribes only its owner's mic —
never voice-inferred, §6.1/G2); raw audio never stored (§12.3); tenant isolation at the DB layer via
RLS (§12.9/R25); session state as event-sourced folds, snapshots discardable (CX-1); single-owner
lease + monotonic fencing token → split-brain impossible (§12.5/R14); merge never drops utterances —
coverage before correctness (§12.6); text-only, never emits audio (§3.2); STT circuit-broken with
utterance-boundary failover (§12.9).

**Scale/Scope**: sized against the PRD envelope for planning (up to ~500 concurrent sessions, ~8
participants avg, ~4,000 agent contexts, §12.3/§12.10) — not a v1 launch gate. Early pilot is a
handful of paired sessions. New surfaces: 1 desktop app, 1 session worker, ~7 tables, 2 transports
(WS/SSE), 3 pairing mechanisms.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan complies |
|---|---|---|
| **I. PRD is law, traceability** | ✅ | Traces to PRD §17 (Phase 3 scope), §7/F7 (pairing), F3–F6 (bootstrap/capture/merge/triage), F6.1a (thread identity), F9.1a (visibility-scope cache only — publishing is Phase 4), §12.3/§12.5/§12.9 (resilience/isolation), CX-1 (derived state), AD-1/AD-2 (§22). Scope conflict already surfaced in spec.md: mediation cards are Phase 4, excluded here (FR-023). No PRD amendment required — Phase 3 is already sanctioned as written. |
| **II. Grounded or silent** | ✅ (mostly N/A) | Phase 3 publishes no claims/cards/nudges, so Gate 3 has no publish path to guard here. Agents reuse the Phase 2 grounded-answer core unchanged; `session_visibility_scope` is computed so Phase 4's publish-time gate is cheap. No new ungrounded output surface is introduced. |
| **III. Security = code** | ✅ | All new tables tenant-scoped, RLS + FORCE, `falcon_app` (non-BYPASSRLS). Agent retrieval runs through the proven `withTenant` path. `session_visibility_scope` = ACL intersection at pairing/join/leave. OAuth calendar tokens stay in `@falcon/secrets`. Raw audio never leaves the device except as a transcription stream. |
| **IV. Honest degradation** | ✅ | Degradation ladder (§7.3): unpaired speech not captured + coverage gap flagged; merge marks gaps, never drops (§12.6); overlapping timestamp margins → order marked ambiguous, not guessed (F5.3); STT loss → local buffer + marked gap (§12.9); network loss → buffer + resync. |
| **V. Measure judgments, pin models** | ✅ | The only judgment surface in Phase 3 is thread-matching (continuation likelihood + topic embedding). Log its inputs/decisions (Langfuse) for later tuning; pin the embedding model (voyage-code-4) and any classifier version; keep behind the existing provider interface. STT behind the thin provider interface with cross-vendor failover (§12.8). |
| **Product invariants** | ✅ | Text-only (no audio emitted). Exact attribution by construction. Consent once-per-pair + always-visible capture indicator (§7.2/§12.4). Blame-neutral shared cards + human-in-the-loop memory: N/A this phase (no cards, no Decision Records). |

**Gate result**: **PASS for planning.** Two Architecture-Decisions-Pending govern this phase and are
resolved by spike in Phase 0 (Constitution "Development Workflow"): **AD-1** clock sync and **AD-2**
LangGraph orchestration — both decided in `research.md` before dependent code. No unjustified
complexity; **Complexity Tracking is empty**.

## Project Structure

### Documentation (this feature)

```text
specs/004-pairing/
├── plan.md              # This file
├── research.md          # Phase 0 output — AD-1, AD-2, STT, transport, event-sourcing, pairing decisions
├── data-model.md        # Phase 1 output — session/membership/code/consent/thread/visibility-scope + Redis event log
├── quickstart.md        # Phase 1 output — two-client validation scenarios mapped to SC-001..SC-009
├── contracts/           # Phase 1 output — WS client↔worker, SSE panel push, REST pairing/consent, agent-context iface
│   ├── ws-client-worker.md
│   ├── sse-panel.md
│   └── rest-pairing.md
└── tasks.md             # /speckit-tasks output (NOT created here)
```

### Source Code (repository root)

```text
apps/
├── web/                          # EXISTING — dashboard; add session/transcript read views (no publishing)
├── worker/                       # EXISTING — BullMQ jobs; host or spawn the session worker runtime
├── session-worker/              # NEW — stateful per-session unit: WS ingest + merge + triage + open-thread
│   └── src/
│       ├── server.ts             #   Fastify + ws; session_id consistent-hash pinning
│       ├── ownership.ts          #   Redis lease + monotonic fencing token (§12.5, R14)
│       ├── eventlog.ts           #   Redis Streams append + snapshot cache + replay (CX-1, §12.3)
│       ├── merge.ts              #   reorder buffer, error margins, order_confidence, gap-mark (F5, §12.6)
│       ├── threads.ts            #   Open Threads table as a fold; continuation + topic match (F6.1a)
│       ├── agents.ts             #   one Participant Agent per human as in-worker async task (§6.3)
│       └── visibility.ts         #   session_visibility_scope = ACL intersection (F9.1a)
└── desktop/                     # NEW — Tauri 2 app
    ├── src-tauri/                #   Rust: cpal capture, Silero VAD (ONNX), WS client, local buffer, capture indicator
    └── src/                      #   React panel (shares components with apps/web)

packages/
├── stt/                         # NEW — thin STT provider iface: Deepgram Nova primary, AssemblyAI failover,
│   └── src/                      #   circuit breaker, utterance-boundary failover, per-vendor confidence calibration (§12.9)
├── core/src/                     # EXISTING — reuse retrieve.ts + answer.ts for Participant Agents
├── db/src/
│   ├── schema.ts                 # EXTEND — session/membership/code/consent/open_thread/visibility tables (RLS+FORCE)
│   └── drizzle/0003_pairing.sql  # NEW — migration + grants to falcon_app
├── integrations/src/             # EXISTING — extend calendar (Google/MS) for session-key matching (F7.1)
├── secrets/                      # EXISTING — calendar OAuth tokens
└── observability/                # EXISTING — log thread-match decisions + coordinator_failover events

tests/
├── integration/                  # session-rls, visibility-scope, event-sourced recovery, ACL isolation
├── contract/                     # WS/SSE/REST pairing contracts
└── support/                      # two-client harness (fake STT seam), Testcontainers Redis, STT fault shim
```

**Structure Decision**: Extend the existing pnpm monorepo. The **session worker is the stateful unit**
(PRD §6.3) and is isolated in `apps/session-worker` so its ownership/lease/event-log concerns don't
bleed into the stateless `apps/web`/`apps/worker`. The **desktop app** is a new `apps/desktop` Tauri
crate + React UI sharing panel components with `apps/web`. A new `packages/stt` mirrors the existing
thin-provider pattern (`@falcon/llm`) so STT is swap-by-config with a circuit breaker. Everything else
reuses shipped Phase 1/2 packages — the new work is additive, not a rewrite.

## Complexity Tracking

> No Constitution violations. This phase is large but each piece is PRD-sanctioned and right-sized;
> the two heavy mechanisms the PRD explicitly defers (continuous semantic sequencer, warm-standby
> Coordinator shards, §12.5) are **not** built here. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
