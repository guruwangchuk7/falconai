# Falcon PRD — CEO / Strategy Review (v2.6)

Reviewer: Claude Code (`/plan-ceo-review`), interactive with Guru · 2026-08-28
Target: `PRD.md` v2.6. Companions: [`architecture-review.md`](./architecture-review.md),
[`review-test-product.md`](./review-test-product.md).
Scope: the strategy-level opens the eng review left (OV-5 cannibalization, OV-7 economics),
plus the premise they implicate. Not a re-run of the technical review.

**Status: D2 APPLIED to `PRD.md` v2.7 (economics-correction pass). D1 HELD** — it is a
PRD + `design.md` + `landing.html` identity change (Appendix B's framing is the landing-page
headline, and `design.md` is copy-do-not-rewrite), so it is evidence-gated. **Trigger to apply
D1:** the Phase 1–2 Wizard-of-Oz result **plus** a Phase 2 solo-retention read. Until then this
doc is the record and the bet stays reversible.

---

## The premise challenge (0A)

Four eng-review findings pointed at one place: **the differentiated, defensible feature (paired
room-level mediation) is simultaneously the hardest to adopt (R1 install friction), the riskiest
socially (OV-1 face threat), and the one the safe adjacent product cannibalizes (OV-5) — while the
actual moat (compounding context + decision memory) accrues fully in solo mode.**

The PRD *builds* solo-first (Phase 2 solo → Phase 4 mediation) but *frames* paired-first
(Appendix B: "everyone else builds a personal assistant; Falcon builds a room-level one"). The
mismatch between the sequencing and the story is the strategic risk.

## Decisions

### D1 — Product bet: SOLO-FIRST WEDGE, paired as earned expansion
Lead the product, story, GTM, and pricing as the personal AI work-assistant (solo nudges +
Decision Records + the context moat). Paired mediation is a power feature teams opt into, validated
by the WoZ test (OV-1), not the bet the company is staked on. Rationale: keeps the moat accruing
from day one, takes install friction (R1) and p^N coverage (OV-6) off the critical path, and turns
paired into a two-way-door bet you validate rather than a near-one-way-door bet. It aligns the
story with the build order already chosen.

### D2 — Pricing: CAPPED FREE → PAID, monetize the moat (resolves Open Q8)
Solo has real COGS (~$1.10/user-hour, ~$6.60/user-month at 6h), so "free forever" is a furnace,
not a wedge. Shape: **free up to ~3–5 meeting-hours/month** (bounds a free user to ~$3–5 worst
case), then a paid solo tier; the **team tier is gated on the compounding decision index + paired
mediation + admin/identity.** Charge for the moat and team features, not the assistant. Keeps the
bottoms-up adoption loop frictionless while capping COGS bleed. (Corrects the earlier "solo free"
recommendation, which ignored per-use COGS — Guru caught it.)

## What D1 would change (HELD — apply only after the trigger, and address these two pushbacks)

Two of the proposed D1 edits need rework before they land, per owner review:
- **R1 demotion:** don't just demote "install friction" — the desktop-install + mic-permission
  barrier still exists for solo (it's a barrier to the *first* user, even if not to value). Keep
  it owned in the risk table, reframed, not deleted.
- **Striking "this is the actual product" from Phase 4:** premature. Don't elevate solo above
  paired in the spec until a Phase 2 solo-retention read shows solo actually retains a user.

The rest of the proposed changes:
- **Appendix B / identity:** lead with the solo personal-AI-teammate value prop; room-level
  mediation as the earned expansion, not the opener.
- **R1 severity:** demote from "defining risk" to "expansion risk" — solo has no install-to-value
  gap, so friction only gates paired, not the company.
- **§17 Phase 4:** strike "This is the actual product." Phase 4 mediation is "expansion validated
  by the WoZ test."
- **§20 metrics:** leading indicators become solo activation + retention + solo→paired conversion;
  invite conversion (30%) becomes an expansion metric, not a survival gate. Keep the room-coverage
  north star (OV-6) for the paired phase.
- **Open Q10 (buyer):** resolves toward bottoms-up PLG — IC adopts solo → team champion turns on
  paired → org buys the decision index.

## What D2 changes in the PRD
- **§18.2–§18.4:** rebuild per-session (COGS is per-session, not per-user — OV-7); state the
  solo (~$1.10/hr) and paired (~$2/hr shared) unit costs; set the free cap and the paid price
  above COGS.
- **§7.3 / Open Q8:** solo is a capped-free tier converting to paid, not an ambiguous "free tier."

## Risks to the bet (watch these)
- **Commodity perception:** solo-first looks like Granola/Otter until paired proves out. Mitigate
  with the decision-memory moat as the paid hook, not the note-taking.
- **Conversion is now the business:** capped-free → paid and solo → paired conversion carry the
  model. Instrument both from Phase 2; pre-register the conversion rate that would kill the paired
  thesis (OV-5).
- **The moat must actually lock in:** if the decision index isn't sticky, there's no paid anchor.
  This raises the priority of the Decision Record lifecycle (F10.1) and erasure design (OV-10).

## Still open
- **OV-10 erasure** — design task (tombstoning + re-embedding the Decision Index), in `TODOS.md`.
- **WoZ test** still gates whether paired ships at all (OV-1); D1 makes a failed WoZ a redirect,
  not a company-ender.
