# D1 decision memo — solo/personal-first vs shared-mediation-first

**Status:** recommendation for Guru to decide. D1 edits `PRD.md` + `design.md` + `landing.html`, so
this memo does NOT touch those — it lays out the evidence and the call. Owner decides; if approved,
the PRD/design edits are a separate deliberate step.
**Date:** 2026-08-29 · **Inputs:** WoZ field test (`woz-results.md`, `woz-test-plan.md`), the
mediation-card validation interviews, Phase-1 shipping (T044 live).

---

## The decision

**D1:** does Falcon lead with the **personal agent** (each person's private, grounded Falcon over
their own + team work) or with **shared live mediation** (the Coordinator writing cards into a
group meeting)? This sets the wedge, the Phase-2 scope, the marketing frame, and the pricing story.

## Recommendation

**Lead personal-first. Ship the personal Falcon — private, grounded Q&A / self-context over your
work — as the wedge. Add the live Coordinator/mediation layer later.** Personal-first, not
solo-only: users still want the Coordinator eventually; it's a layer on top, not the entry point.

## Why — the evidence

Across ~5-6 teams (2 fully instrumented card sessions at n=5 each, plus qualitative sessions
including a self-context team; one team asked the architecture question directly):

1. **The problem is real (H1 holds).** Forgotten GitHub/issue context is the pain, worse with
   infrequent meetings. Instrumented: **4/5 didn't retain the load-bearing fact, 4/5 (80%) said it
   would change their decision** — replicated across two independent teams.

2. **The card shape is settled (H2 holds).** Symmetric/blame-neutral (Variant B) beat asymmetric
   (A) for every one of 10 people (**A avg 3.6 / B avg 1.0**). Bank B as canonical (PRD F9.2a).
   *But note:* face-threat only exists because a **shared** card names someone publicly — a
   **personal** agent that privately fills your gap sidesteps the whole problem.

3. **Live push has a latency wall (H3 — the load-bearing risk).** Cards were fine at ~48s but
   **failed around ~61s** (3/5 complained "too slow," "I'd want this faster"). Live shared
   mediation only works near-real-time — a genuine engineering risk, and the single biggest reason
   *not* to lead with it.

4. **Users converged on the personal architecture (D1 signal).** The one team asked directly chose
   **private per-person agents + one Main Coordinator**, not one shared Falcon — which is exactly
   the PRD architecture. They arrived at it themselves.

5. **The most-wanted feature is personal pull/Q&A (≥3 teams, unprompted).** "What did we finish in
   GitHub last week?" / "What did I do for auth, and does it match the architecture?" (for standup,
   review, handoff prep). This mode is **private by nature, has no latency problem, and is ~80%
   buildable on the Phase-1 context layer already shipped** — the digest is a coarse version of it.

**The pattern:** the highest-value, lowest-risk, most-requested thing is the personal agent's
private context/Q&A. Live shared mediation is validated but harder, latency-bound, and later.

## What this changes

- **Wedge / Phase 2 scope:** make Phase 2 the **personal Falcon** — private Q&A + self-context over
  each user's own artifacts (retrieve + generate on Phase 1), plus a clean sidebar/panel UI (users
  liked the sidebar). This is a *reordering* of PRD §17: personal-agent value **before** the audio
  / pairing / Coordinator stack, not after.
- **Marketing (`landing.html` / `design.md`):** reposition around "a personal AI that remembers
  your work and gives you the right context when you need it," with team mediation as the expansion.
- **PRD §9.2:** adopt Variant B as the default shared-card rhetoric (for when the Coordinator layer
  ships).
- **Pricing (D2, already applied):** personal-first fits the capped-free model cleanly — solo value
  before team value.

## Honest caveats / what would change my mind

- **Evidence is qualitative and small-n.** "Would be useful" ≠ "I paid / switched." No costly
  action was taken by any participant.
- **The formal D1 trigger also wanted a Phase-2 solo-retention read** — which can't exist before
  Phase 2 is built. Resolution: treat the WoZ as sufficient to *commit to the personal-first shape*
  and make **solo retention the Phase-2 success metric** (build-measure-learn checkpoint), not a
  pre-gate. If solo retention is weak once real, revisit before investing in the Coordinator stack.
- **Shared-vs-personal was asked directly to only one team;** the earlier teams' shared model was
  inferred. Confirm the preference in 1-2 more teams to firm it up (cheap).
- **Change-my-mind signal:** if the next teams say the *live, in-meeting* moment (not later recall)
  is what they'd pay for, and latency turns out solvable, mediation-first comes back on the table.

## The ask

Approve **personal-first (Q&A/self-context wedge), Coordinator later** as the D1 direction. On
approval: scope Phase 2 around the personal agent via `/speckit-specify`, and schedule the
PRD/design/landing edits as a deliberate pass.
