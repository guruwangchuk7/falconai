# Quickstart & Validation: Pairing

Runnable validation scenarios that prove the Phase 3 substrate works end-to-end, each mapped to a
Success Criterion in [spec.md](./spec.md). This is a **validation/run guide** — implementation lives in
`tasks.md` + the code. Scenarios run via the deterministic **two-client harness** (fake STT seam,
mirroring Phase 2's `FALCON_FAKE_LLM`) so they are keyless and CI-runnable; a subset also runs live on
real desktop capture for the feel-pass.

## Prerequisites

- Phase 1 + Phase 2 running locally (see `reference/` local-run notes): Postgres+pgvector (Supabase),
  Redis (Upstash or Testcontainers), `@falcon/db` migrated incl. `0003_pairing.sql`, calendar
  integration configured for V1.
- `apps/session-worker` running; `apps/desktop` built (or the harness's fake-capture client).
- Env: `FALCON_FAKE_STT=1` for deterministic runs; real Deepgram/AssemblyAI keys for the STT-failover
  live check (V8).

## Scenarios

| # | Validates | Steps | Expected | SC |
|---|-----------|-------|----------|-----|
| **V1** | Calendar auto-pair (F7.1) | Two users invited to one calendar event start their clients | Both land in the same `session_id` with no user action; each panel shows "Paired with X" | SC-001 |
| **V2** | Team auto-pair + code (F7.2/F7.3) | No shared event: user A speaks, user B speaks within 90s → accept prompt. Separately, join a third by 6-char code | B joins via one-tap prompt; C joins by code; expired/over-limit code is rejected | SC-001 |
| **V3** | Exact attribution (G2, §6.1) | Both speak, including talking over each other | Merged transcript attributes every utterance to the correct speaker; zero cross-talk misattribution; attribution is by connection owner, never voice-inferred | SC-002 |
| **V4** | Join latency (F3) | Start a session; a second participant joins mid-session | Joiner appears in the shared feed, agent provisioned + backfilled with compressed transcript, in < 10s | SC-003 |
| **V5** | Coverage-first merge (§12.6) | Inject a stalled client stream and a burst of overlapping speech | 100% of captured utterances present; the stall is a **marked gap**, never a silent drop; overlapping-margin pairs marked `ambiguous_order` | SC-004 |
| **V6** | Event-sourced recovery (CX-1) | Build up a session, **delete all Redis snapshots**, force worker recovery from the log | Recomputed membership + merged transcript + Open Threads are **identical**; deleting snapshots is a correctness no-op | SC-005 |
| **V7** | No raw audio stored (§12.3/R6) | Run a full session, then audit Postgres + Redis + disk | No raw audio anywhere; only transcript/events persist | SC-006 |
| **V8** | ACL scope + STT failover | (a) Each agent retrieves only its owner's ACL-visible artifacts; `session_visibility_scope` = true intersection on each join/leave. (b) Fault-shim kills the Deepgram socket mid-utterance | (a) No agent reaches out-of-scope artifacts; scope exact + versioned. (b) Failover to AssemblyAI at the utterance boundary; abandoned utterance re-sent from buffer; no permanent gap | SC-007 |
| **V9** | Consent once-per-pair + capture indicator (§7.2/§12.4) | First-ever pair of A+B; then re-pair; then a cross-workspace pair | One-time consent card on first pair only; internal re-pair auto-pairs; cross-workspace re-prompts; capture indicator visible 100% of capture time | SC-008 |
| **V10** | Failover integrity (§12.5/R14) | Induce session-worker failover under load | New owner resumes via lease + higher fencing token; clients reject stale-token messages; no double-published events, no lost utterances, within recovery budget | SC-009 |
| **V11** | Open-thread tracking (F6.1a) | Run a two-topic discussion that drifts and returns | Open Threads table opens/continues/merges correctly; router emits score not id; **no gates/cards/escalation exist** | (US3) |

## Phase boundary check (must stay true)

- No mediation card, private nudge, intervention gate, or Decision Record is produced by any scenario
  (FR-023/FR-026). The SSE contract's event enum contains no `card`/`nudge`/`escalation` type.
- Falcon emits **no audio** into the meeting at any point (§3.2).

## Done / go-to-next

All V1–V11 green on the harness + a live two-person feel-pass (V1/V3/V4/V9 on real capture) = Phase 3
substrate proven. Next phase (Phase 4 — Mediation) builds the Coordinator, intervention gates, and
publishing **on top of** this session/thread/visibility-scope substrate.
