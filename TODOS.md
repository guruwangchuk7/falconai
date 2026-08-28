# TODOS — surfaced by the PRD engineering review (2026-08-28)

Source: `reviews/architecture-review.md` + `reviews/review-test-product.md`. These are
owner-decisions and pre-build actions, not implementation tasks (repo is at the SETUP-ONLY gate).

## Live bug — waitlist (code fixed; needs your keys)
- [x] **Fallback hardened.** `design/landing.html` no longer fakes success. Blank keys or a failed
  insert now show a `mailto:hello@falcon.ai` link with the visitor's email prefilled (R12/CX-2
  degraded path). Version tile → v2.7. Fabricated social-proof numbers replaced with true
  product-fact tiles.
- [ ] **Paste Supabase keys (yours, ~10 min).** Create the `waitlist` table + anon-insert RLS
  policy (SQL is in the file comment, lines 761–769), then paste your project URL + anon key into
  lines 775–776. Until then the form correctly routes signups to email instead of dropping them.

## Blocker-class (resolve before the relevant phase commits)

- [ ] **Consult a tech-privacy lawyer on capture consent (OV-4).** All-party-consent states
  (incl. CA) + Illinois BIPA (biometric) bear on system-audio fallback and on recording
  non-users. This is the one issue where "ask a lawyer" is the answer, not a hedge. A couple
  hours now vs discovering it during a deal. **Blocks:** finalizing §12.4 / F4.7 / §7.3.
- [ ] **Cut system-audio fallback (F4.7) from v1** and move `pairing_consents` from pairwise to
  session scope (OV-4/OV-9). Depends on the legal read but is the recommended default regardless.
- [ ] **Tenant isolation is blocker-class (R25/A2):** the pgvector partitioning + RLS pooling
  rules and the `EXPLAIN`-partitions-removed CI assertion must exist before any multi-tenant data
  path ships. Five silent-failure paths (partition-prune, RLS pooling, omission diff, ACL
  intersection, blame-neutral) need tests written first.

## Thesis / validation (do before building the Coordinator)

- [ ] **Card-quality gate at end of Phase 1** (Issue 0): blind A/B vs the human baseline,
  pre-registered bar and N, defined no-go branch (fail → 2wk iterate → re-gate once → cut
  mediation, ship context+summary).
- [ ] **Wizard-of-Oz live-card test in Phase 1/2** (OV-1): model-generated card, fixed template,
  operator only chooses when to send; measure behavior (course change, talk-time drop) + async
  asymmetric follow-up + revealed preference; vary the power gradient (include a manager-in-room
  session); test asymmetric vs symmetric/face-saving card shapes.
  - [x] Card mockups drafted: `design/woz-cards.html` (both shapes, panel-width, Quiet Voltage
    tokens, Appendix A content). Ready to show in the test; wire to real model output when Phase 1
    retrieval works.
- [x] **Panel a11y/always-on-top constraints** added to PRD §9.3 (polite live-region card
  announce; grayscale-safe private/shared distinction; reduced-motion; opaque surface + 44px targets).
- [ ] **AD-1 bake-off in Phase 3 planning** (OV-13): server-arrival vs clock-reconstruction on
  Phase 0 recordings, judged on card quality from the merged transcript (not timestamp
  accuracy), with at least one mixed-network (VPN/hotel-wifi) recording. Hold F5/§15 detailed
  design until it resolves.

## Costing / metrics (decide, don't drift)

- [ ] **Cost the Phase-1 overload** — Issue 0 gate + trust-tier schema + provenance/omission all
  push into Phase 1; total them against the time box before committing, or Phase 1 slips by
  accumulation.
- [x] **Rebuild the unit economics (OV-7)** — DONE in PRD v2.7 §18.4 (per-session; solo/paired
  unit costs; margins 85%/88%; break-even ~20).
- [ ] **Budget the free tier as capped CAC** (added v2.7 §18.4, needs a real number): set the
  aggregate monthly free-tier-COGS ceiling and the conversion-rate floor that auto-tightens the
  cap. Free COGS scales with conversion (~$29/paying-user at 3% conversion), not the per-user cap.
  Levers: 2-hour cap, or gate free on a connected GitHub account (filters by intent).
- [ ] **Fix the north-star metric (OV-6):** "% of decision-bearing meetings with all disputants
  paired," not auto-pair rate among the installed (coverage is p^N).
- [ ] **Pre-register the solo→paired conversion kill-threshold (OV-5).**

## Apply the change-list to PRD.md — DONE for decided items (v2.6)
- [x] Decided items folded into `PRD.md` v2.6 (changelog + body edits across ~25 sections).
- [ ] Consent-legal-dependent sections deferred until the lawyer read: §12.4 consent flow, F4.7
  final disposition, §6.1 "Privacy is cleaner" line, §16 "on their phone" row.
- [x] Rebuild §18.2–§18.4 economics per-session (OV-7) — DONE in v2.7 (attendee-mix assumption
  labeled; free tier reframed as capped CAC with a ceiling + conversion floor).
- [ ] Design the Decision-Index erasure/tombstoning approach (OV-10) — noted OPEN in the PRD.
