# Security-claim inventory — privacy / access / data handling

**Snapshot, not a standing guarantee.** Verified against commit **`c346839`** on `feat/in-meeting-listener`, **2026-09-03**. This records which privacy/access/data-handling claims in the PRD & design docs are actually enforced *in code at this commit* — it will drift as code changes. Re-verify before a pilot or security review. Scope is deliberately narrow: only claims where a wrong assertion costs a broken user promise or a failed review. Aspirational instrumentation/metrics claims are out of scope.

**Status:** ✅ enforced · 🟡 partial · ⬜ intended, not built. Every ✅ names the test or policy that makes it checkable.

| Claim | Doc | Enforcement point | Status |
|---|---|---|---|
| Tenant isolation — every tenant data row scoped by `workspace_id` | §12.9 / R25 | `*_tenant_isolation` RLS policies (ENABLE+FORCE) on all tenant tables (0001/0002/0006); app connects as non-BYPASSRLS `falcon_app`. Tests: `tests/integration/acl.test.ts`, `decision-memory.test.ts` (cross-tenant no-op) | ✅ |
| OAuth tokens never in the app DB | R26 / §12.9 | `packages/secrets` `FileSecretStore` envelope-encrypts; app DB holds only `secret_ref`. CI: `no-token-in-db` job | ✅ (dev/file backend; prod Infisical = ⬜ stub) |
| Raw audio never stored past the transcription stream | §12.3 / R6 | `runIngest` appends `utterance_final` **text** only (`apps/session-worker/src/server.ts:47`); desktop streams PCM, never writes to disk (`main.rs`). Test: `tests/integration/ws-client-worker.test.ts` | ✅ |
| Working-copy transcript TTL (24–72h) actually deleted | design §6 (D6) + consent line | `expires_at` + extraction-time delete **and** `reapExpiredWorkingCopies` maintenance sweep every 30 min (`apps/worker/src/index.ts`). Test: `tests/integration/meeting-retention-helpers.test.ts` (reaper deletes past-TTL, spares live) | ✅ **(fixed at `c346839`; was 🟡 — no reaper)** |
| Verbatim spans visible only to meeting attendees | design §8 (D10) | RESTRICTIVE RLS `decision_span_attendee_read` (0008) + `withViewer`; fail-closed. Test: `tests/integration/decision-tier-read.test.ts` (attendee sees, non-attendee 0) | ✅ |
| `attendees_only` summary invisible on read paths | design §8 (D13) | viewer tier predicate in `getDecision`, `searchDecisions`, `listConfirmed`. Tests: `decision-tier-read.test.ts`, `decision-supersede-tier.test.ts` | ✅ |
| **Unconfirmed queue** does not leak meeting drafts workspace-wide | (D13 corollary) | meeting decisions created `visibility=NULL` (0010); `listQueue` applies the viewer tier — NULL & `attendees_only` fall to the attendee check, viewerless is fail-closed. Test: `tests/integration/listqueue-filter.test.ts` (non-attendee's queue omits a meeting draft) | ✅ **(fixed at `c346839`; was 🟡 GAP — pre-confirmation exposure)** |
| Meeting decision can't be confirmed without an explicit visibility | design §8/§14 (D13) | `confirmDecision` write-gate `visibility IS NULL → visibility_required`; two-button UI. Test: `tests/integration/decision-visibility-set.test.ts` (refused without choice; writes nothing) | ✅ |
| Answer/citation path tier-gates decisions | F7.2 | `answerQuestion` threads `requesterUserId` → `searchDecisions` (`packages/core/src/answer.ts`). Test: `decision-memory.test.ts` (four-state boundary) | ✅ |
| Unconfirmed-candidate surfacing carries no content | design §8 | `matchUnconfirmedCandidates` returns metadata only (`decision-status.ts`). Test: `decision-memory.test.ts` | ✅ |
| One-way visibility widening (never narrows) | D13 | `setVisibility` widen-only, idempotent. Test: `decision-visibility-set.test.ts` | ✅ |
| Only **confirmed** records retrievable / ground answers | F10.1 / R23 | `status='confirmed'` filter in `searchDecisions`/answer. Test: `decision-memory.test.ts` | ✅ |
| Provenance-gated output — claim → ACL-checked artifact (FABRICATION direction) | F7.2 / R4 / R20 | Phase-1 `retrieve()` ACL check; `groundClaims` verify-then-drop (cited→retrieved). Test/gate: `acl.test.ts`, `answer.test.ts` + CI SC-004 | ✅ |
| F7.2 **omission diff** — flag a high-relevance retrieved artifact the answer DROPPED (SUPPRESSION direction; provenance-gating can't see this) | F7.2 (eng review A3, "build first") | `computeOmissionDiff` + shadow log `[f7.2-omission-shadow]` in `answerQuestion` (`packages/core/src/answer.ts`). Test: `tests/unit/omission-diff.test.ts` | ✅ **SHADOW/log-only (this commit); was an UNTRACKED gap found in the 2026-09-03 conformance audit.** Blocking enforcement is ⬜ Phase-4 |
| A8 `audit_log` / `failover_event` tables | `prd-eng-review` A8 (DECIDED) | eval-set satisfied (`packages/evals`, `calibrate.ts`); the two tables are not in any migration | ⬜ **Phase-4-deferred** (F9.1a redaction audit / Coordinator failover) — now tracked, was decided-but-implicit |
| PR-mined decision **text** carries a visibility tier | §21 item 12 | `origin='suggested'` records land `workspace`; no tier | 🟡 documented, not built (GitHub ACL governs the *evidence*, not the decision text) |
| Multi-workspace mis-attribution guard | §21 item 13 | — (RLS authorizes a legitimate member; can't catch a wrong-workspace pairing) | ⬜ open item |
| Publish-time ACL intersection on shared cards | F9.1a / R15 | — | ⬜ Phase 4 |
| Blame-neutral / nudge-only performance facts | F9.2a / R24 | — | ⬜ Phase 4 |
| Gate 3 — no mediation card without a citation | F8 / R3 | — | ⬜ Phase 4 |

## Notes
- The ⬜ Phase-4 rows are not gaps — they gate features not yet built; listed so a reader doesn't mistake "designed" for "enforced."
- The two 🟡→✅ transitions (`c346839`) came out of the first sweep: the pre-confirmation queue leak and the missing TTL reaper.
- **Update (2026-09-03 conformance audit):** the audit found one untracked silent divergence — the **F7.2 omission diff** was mandated (eng review A3, "build first, shadow mode") but never built and never surfaced. Now shipped in shadow/log-only mode + tracked (row above). The **A8** audit/failover tables were "decided" but implicit; now tracked as Phase-4-deferred. Rest of the audit: strong conformance, no other untracked divergences (the shipped surface enforces its non-negotiables in code + tests + CI).
- Re-run the enforcing tests (`pnpm exec vitest run tests/integration/... --pool-options.forks.singleFork`) to re-verify any ✅ against a later commit.
