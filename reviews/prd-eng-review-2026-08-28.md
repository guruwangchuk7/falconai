# Falcon PRD — Engineering Review (v2.5) — Index

Reviewer: Claude Code (`/plan-eng-review`), interactive with Guru · 2026-08-28
Target: `PRD.md` v2.5 (Draft 2, architecture-board pass). Split into two logs:

- [`architecture-review.md`](./architecture-review.md) — cross-cutting principles CX-1/CX-2 and
  findings A1–A8.
- [`review-test-product.md`](./review-test-product.md) — Issue 0 (card-quality gate), Section 2
  spec nits, T1–T3 (test/eval), P1 + perf folds, the Phase-1-overload watch, and required outputs.

These docs are the review record and the PRD change-list. The owner (Guru) lifted "keep PRD
verbatim" for this pass: `PRD.md` is now **v2.6** with a full changelog entry plus the decided
body edits applied across §6.1, §6.3, §12.1, §12.2, §12.3, §12.5, §12.6, §12.7, §12.8, §12.9,
§13, §14, §16, §17, §18.4, §20, F6.1, F7.1, F7.2, F8, F9.1a, F9.2a, F9.4, R7, R20, AD-1.
**Deferred pending the privacy-lawyer read** (to avoid editing twice): §12.4 consent flow, F4.7's
final disposition (provisionally CUT), the §6.1 "Privacy is cleaner" line, and the §16 "on their
phone" row. Still open (owner): OV-5, OV-7 (strategy review), OV-10 (erasure design — noted OPEN
in the PRD). Nothing was implemented (repo stays at SETUP-ONLY).

## Decision ledger

| Item | Status | Ruling |
|---|---|---|
| Step 0 card-quality gate | DECIDED | end-of-Phase-1, blind A/B, pre-registered bar, no-go branch |
| A1 worker failover | DECIDED | symmetric reconciler + snapshots + client buffer; re-derive SLO |
| A2 isolation vs ANN | DECIDED | hash-partition + RLS floor + pooling rules + CI assert; pgvector ≥0.8 |
| A3 injection | DECIDED | structured gate-stance + omission diff + trust tiers + narrow claim |
| A4 embedding model | DECIDED | voyage-code-4 (1024), model/version per row; verify via recall@k eval |
| A5 thread identity | DECIDED | Coordinator owns; router emits continuation_likelihood; delete the field |
| A6 STT failover | DECIDED | utterance-boundary + addressable buffer re-send; latency-as-degradation; one-way |
| A7 publish race | DECIDED | version-stamped card, bounded hold, speculative synthesis on heat |
| A8 missing tables | DECIDED | add audit-log / eval-set / failover-event tables |
| T2 boundary tests | DECIDED | continuous property tests + red-team |
| T3 injection timing | DECIDED | structural defense in Phase 1/2 (shadow mode), suite Phase 4 |
| P1 cost ceiling | DECIDED | pool per-workspace/month + engagement signal + legible degrade |
| OV-1 social viability | DECIDED | Wizard-of-Oz live test early; symmetric card shape; behavioral metrics |
| OV-2 in-person | DECIDED | co-location detection + room mode in v1; headsets = full attribution |
| OV-4 consent/legal | DECIDED | cut system-audio fallback; session-scope consent; lawyer brief sent |
| OV-8 basis leak | DECIDED | send scored boolean + thread_id only across the private→Coordinator boundary |
| OV-13 AD-1 timing | DECIDED | bake-off in Phase 3 planning; judge on card quality; mixed-network recording |
| OV-6 metric | DECIDED (as-recommended) | north star = % meetings with all disputants paired |
| OV-11 cross-vendor LLM | DECIDED (as-recommended) | genuine cross-vendor fallback tier |
| Section-2 nits | DECIDED (accepted) | fix premise_challenged example; RLS the private_nudge column |
| OV-5 cannibalization | **OPEN** | held for narrowed strategy-mode review |
| OV-7 economics | **OPEN** | held for strategy-mode; COGS denominator = good news |
| OV-10 erasure design | **OPEN** | needs a tombstoning/re-embedding design decision |

## Failure modes (new codepaths from this review)

| Codepath | Realistic failure | Test? | Error handling? | Silent? | Verdict |
|---|---|---|---|---|---|
| Worker reconciler (A1) | dead worker's slot never re-claimed (membership gossip stalls) | needs chaos test | reconcile loop + lease TTL | no (`coordinator_failover` alert) | covered once A8 event + chaos test land |
| Snapshot/replay (A1, CX-1) | replay > budget on a long session | snapshot-noop + replay-time test | snapshot cache | no | covered by CX-1 invariant test |
| pgvector partition prune (A2) | qual stops pruning → full-scan latency spike | `EXPLAIN` CI assertion | none at runtime | **yes, silent** | **critical gap without the CI assertion** |
| RLS pooling (A2) | `SET LOCAL` outside a txn / `BYPASSRLS` role → cross-tenant leak | RLS integration test | DB-enforced if configured | **yes** | **critical — needs the pooling-rules test** |
| STT failover (A6) | latency-not-error degradation; lost in-flight utterance | fault-injection shim | circuit breaker + re-send from buffer | no if buffer addressable | covered once shim + addressable buffer land |
| Injection omission (A3) | poisoned artifact suppresses a true citation | retrieved-vs-cited diff + synthetic corpora | omission diff flag | **yes** until diff ships | **critical until T3 lands the diff** |
| ACL intersection (T2) | prompt change reopens a cross-user leak | continuous property test | publish-time check | **yes** | **critical without the property test** |
| Blame-neutral (T2) | card names a person's performance | continuous property test | synthesis constraint | **yes** (social) | **critical without the property test** |
| Publish race (A7) | card published about a resolved thread | card-version invalidation test | version bound + discard | no | covered by CX-1 versioning |

Five silent-failure paths (partition prune, RLS pooling, omission, ACL intersection,
blame-neutral) are the ones to build tests for FIRST — each is silent, catastrophic, or both.
