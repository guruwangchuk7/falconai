# Falcon — Review Dossier (index)

Everything from the 2026-08-28 review sessions, in one place. The PRD is the product; the
`reviews/` docs are the review record + change-list; `TODOS.md` is the action backlog.

## Source-of-truth documents (pre-existing)
| File | What it is |
|---|---|
| `../PRD.md` | Product requirements. Now at **v2.7** (eng-review pass + economics correction applied). The v2.6 and v2.7 changelogs at the top summarize every decision. |
| `../design.md` + `../design/landing.html` | Hand-built landing page + "Quiet Voltage" design system. Untouched by review. |
| `../CLAUDE.md` | Operating instructions / constraints (SETUP-ONLY gate, sources of truth). |
| `../.specify/memory/constitution.md` | Engineering principles (Spec Kit). |
| `../TODOS.md` | Action backlog surfaced by the reviews (blocker-class, thesis, costing, apply-to-PRD). |

## Review documents (this session)
| File | What it covers | Read it for |
|---|---|---|
| `prd-eng-review-2026-08-28.md` | Index + failure-mode table + **full decision ledger** (20 decided, opens marked) | The one-page overview and status |
| `architecture-review.md` | Cross-cutting principles CX-1/CX-2 + findings A1–A8, each RESOLVED with the ruling | The engineering/architecture discussion |
| `review-test-product.md` | Issue 0 (card-quality gate), Section-2 nits, T1–T3 (test/eval), P1 + perf, **Outside Voice OV-1…14** | The test/product/legal discussion + the independent challenge |
| `ceo-review-2026-08-28.md` | Premise challenge + **D1 (solo-first wedge)** + **D2 (capped-free pricing)** + implications | The strategy discussion |
| `legal-brief-capture-consent.md` | Scoped brief for a privacy lawyer (consent, wiretap, BIPA, erasure) | Send to counsel; gates the consent sections |

## Reading order (fastest path to "what happened and why")
1. `prd-eng-review-2026-08-28.md` — the ledger + failure modes (the map).
2. `ceo-review-2026-08-28.md` — the two strategy decisions that reframe the product.
3. `architecture-review.md` — the CX-1/CX-2 invariants and A1–A8 (the deepest technical calls).
4. `review-test-product.md` — the outside voice (OV-1…14) and the test/eval/legal detail.
5. `PRD.md` v2.6 changelog — how it all landed in the spec.

## How to see exactly what changed in the PRD
`git diff PRD.md` (changes are uncommitted). The v2.6 changelog paragraph near the top of
`PRD.md` narrates the same set of decisions in the PRD's own house style.

## Combined decision ledger

### Engineering (from the eng review — all applied to PRD v2.6 unless noted)
- **CX-1** no derived state stored as a mutable value (folds over the log, version-stamped).
- **CX-2** escape hatches amplify the failure they bypass (overrides key on value/intent, not symptoms).
- **A1** symmetric worker reconciler + snapshots + client buffer; re-derived recovery SLO.
- **A2** hash-partition by workspace_id + RLS floor + pooling rules + CI partition-prune assertion.
- **A3** structured gate-stance + omission diff + trust tiers + narrowed injection claim.
- **A4** voyage-code-4 (1024), model/version per row, never in the schema.
- **A5** Coordinator owns thread identity; router emits continuation_likelihood (field deleted).
- **A6** utterance-boundary STT failover + addressable buffer re-send + latency-as-degradation + one-way.
- **A7** version-stamped cards, bounded hold, speculative synthesis on thread heat.
- **A8** add audit-log / eval-set / coordinator_failover tables.
- **T2** continuous property tests for ACL-intersection + blame-neutral (not one-time red-team).
- **T3** structural injection defense in Phase 1/2 (shadow mode); suite is the Phase 4 gate.
- **P1** pool the budget per-workspace/month; degrade legibly; key headroom on value not spend.
- **OV-1** Wizard-of-Oz live-card test early; test a symmetric/face-saving card shape.
- **OV-2** co-location detection + room mode in v1; headsets = full attribution.
- **OV-4** cut system-audio fallback (blocker-class); session-scope consent. *(consent body edits deferred pending legal)*
- **OV-6** north star = % meetings with all disputants paired.
- **OV-7** COGS is per-session; margins better than stated; rebuild §18.4.
- **OV-8** send only scored boolean + thread_id across the private→Coordinator boundary.
- **OV-11** genuine cross-vendor LLM fallback tier.
- **OV-13** AD-1 clock bake-off in Phase 3 planning; judge on card quality; mixed-network recording.

### Strategy (from the CEO review)
- **D2** CAPPED FREE → PAID solo; monetize the moat (decision index + team/paired). **APPLIED to PRD v2.7** (§18.4 rebuilt per-session, Open Q8 resolved).
- **D1** SOLO-FIRST wedge, paired as earned expansion. **HELD** — identity change spanning PRD + `design.md` + `landing.html`; evidence-gated. Trigger: WoZ result + Phase 2 solo-retention read. Recorded in the v2.7 changelog and `ceo-review-2026-08-28.md`.

### Open (owner / follow-up)
- **D1 (solo-first repositioning)** — HELD, evidence-gated. Apply after the WoZ result + a
  Phase 2 solo-retention read, and address the two pushbacks (keep the install barrier owned in
  the risk table; don't strike Phase 4's "actual product" until solo retention is shown).
- **OV-10** — erasure/tombstoning design for the Decision Index.
- Consent-legal sections (§12.4, F4.7 final, §6.1 privacy line, §16 phone row) — pending the lawyer read.
- **External-clock work (do these next):** send the lawyer brief; start WoZ recruiting; run the
  latency-window measurement (median-7s / card-arrival-vs-moment, OV-3).
