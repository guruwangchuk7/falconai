# Quickstart: Personal Falcon — validation guide

How to prove Phase 2 works end-to-end once implemented. Validation scenarios map to the spec's
acceptance criteria and Success Criteria. No implementation detail here — see `data-model.md`,
`contracts/api.md`, and (later) `tasks.md`.

## Prerequisites

- Phase 1 running (proven live): web + worker up, real Supabase (via `falcon_app` /
  `APP_DATABASE_URL`), Upstash Redis, a connected GitHub install with synced artifacts + embeddings.
  (Same environment used for the T044 run.)
- The `0002_personal_falcon` migration applied and `falcon_app` granted on the new tables.
- Signed in as a user with synced work.

## Setup

```bash
pnpm install
pnpm --filter @falcon/db migrate           # applies 0002_* (owner via DATABASE_URL)
pnpm --filter @falcon/web dev              # dashboard (reads APP_DATABASE_URL → falcon_app)
pnpm --filter @falcon/worker dev           # if async summaries are enabled
```

## Validation scenarios

### V1 — Ask about your own work (P1 / FR-001, FR-003, FR-005; SC-001)
- Open the Falcon panel, ask: *"What did I do for authentication?"*
- **Expect**: a concise answer; every claim shows a source link; opening a link resolves to the real
  PR/commit. **Fail** if any claim has no citation or a link 404s.

### V2 — Honest "no grounded answer" (FR-004; Constitution II/IV)
- Ask something absent from synced work: *"What did I do on the billing system?"* (no such work).
- **Expect**: explicit "no grounded answer," no invented content. **Fail** if it fabricates.

### V3 — Team context, access-scoped (P2 / FR-002, FR-006; SC-002)
- Ask: *"What happened with Feature X?"* about work the user can access → grounded, cited answer.
- As a *second* user in the same tenant lacking access to an artifact, ask about it → its contents
  never appear. **Fail** if any cross-user/cross-tenant content leaks. (Automate in the integration
  guard suite alongside the Phase 1 isolation tests.)

### V4 — Confirmed decisions only (FR-007)
- Ask about a topic that has both a superseded and a confirmed decision.
- **Expect**: only the confirmed decision is presented as current. **Fail** if a superseded record
  is surfaced as a decision.

### V5 — Targeted prep summary + edit authority (P3 / FR-008, FR-009)
- Request a summary scoped to "authentication" → grounded, cited brief.
- Edit it, save, reload → the edited text is what's shown. **Fail** if the edit is lost or the
  generated version reappears.

### V6 — Follow-up context (FR-011)
- After V1, ask *"Which of those touched the callback flow?"* without repeating context.
- **Expect**: the answer uses the prior turn. **Fail** if it treats the question as standalone.

### V7 — Latency (SC-003)
- Measure time-to-first-token and time-to-complete over ~10 representative questions.
- **Expect**: median complete < ~10s; first tokens stream quickly.

### V8 — Degraded provider (Constitution IV)
- Simulate the LLM/embeddings provider returning an error.
- **Expect**: an honest degraded message (`503`), never a guessed answer.

### V9 — Retention metric integrity (SC-005)
- Ask N questions across M users; confirm exactly one `query_event` per ask and that a
  return-to-ask-within-a-week query can be computed. **Fail** if events are missing/duplicated.

## Success-criteria coverage

| SC | Covered by |
|---|---|
| SC-001 (0 ungrounded claims) | V1, V2 + contract test 1/2 |
| SC-002 (0 ACL/tenant leaks) | V3 + contract test 3 (integration guard) |
| SC-003 (<~10s median) | V7 |
| SC-004 (≥80% useful when answerable) | V1/V3/V5 review + answer-grounding eval (@falcon/evals) |
| SC-005 (solo retention) | V9 + retention query |
| SC-006 (helpful for prep) | V5 user review |

## Definition of done for the feature

All V1–V9 pass, the answer-grounding eval clears its bar on the golden set (Constitution V), the
integration guard suite (incl. V3 isolation) is green in CI, and the PRD has been amended for D1
(Constitution I) before this ships.
