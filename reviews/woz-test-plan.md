# Wizard-of-Oz test plan — do grounded mediation cards work?

Purpose: validate the **core Falcon bet** — that a text-only, artifact-grounded mediation card,
delivered mid-meeting, changes the decision for the better — **before** building any of the audio /
pairing / Coordinator machinery. The "AI" is a human wizard. This gates the held **D1** (solo-first
repositioning) and de-risks the whole roadmap (PRD §17). Cards to test live in
[`design/woz-cards.html`](../design/woz-cards.html). Related: OV-1 (WoZ design), OV-3 (latency).

## Hypotheses (falsifiable)

- **H1 — Value.** A grounded card surfaces something ≥1 participant *didn't know*, and ≥1
  participant says it *would change* what they do. (If cards rarely land new/actionable info, the
  product thesis is weak — stop and rethink.)
- **H2 — Shape.** The **symmetric** card (Variant B — conflict externalized onto missing shared
  facts) is accepted with less face-threat than the **asymmetric** card (Variant A — names who
  didn't know), for equal information. (Decides the default card rhetoric.)
- **H3 — Timing (OV-3).** A card can be written and land **while the moment is still open** — i.e.
  before the group has already moved on. Measure wizard-write latency; if it routinely lands after
  the decision, live mediation is the wrong frame and async digests win.

## Method — human wizard, real stakes

1. **Recruit 4–6 teams** (piggyback the Phase-0 context teams). A team = 2–4 people with a real,
   upcoming decision meeting (roadmap trade-off, design review, prioritization).
2. **Pre-load context.** For each participant, the wizard reads their recent PRs/issues/decisions
   (the same artifacts Phase 1 would index) and prepares 2–3 candidate cards, each tied to a
   **real, citeable artifact** (enforce Gate 3 by hand: no citation → no card).
3. **Run the meeting.** The wizard listens (in the room or on the call) and, at the moment a
   knowledge gap or contradiction surfaces, writes ONE card into a side channel (Slack DM / shared
   doc), never spoken aloud. Falcon writes, it never talks.
4. **Assign the card shape.** Within-subjects where possible: each team sees both a Variant A and a
   Variant B card across the session (counterbalance order); or A/B across teams if one card per
   meeting is cleaner.
5. **Debrief immediately** (the validation-interview frame Guru is already using — see the
   mediation-card-validation notes): per recipient, log **Y/N did-you-know**, **Y/N would-it-change
   what you do**, **surprises**, and a **face-threat rating** (1–5: "did this feel like it blamed
   someone?"). Capture the **wizard-write latency** (moment-surfaced → card-delivered) per card.

## What we measure

| Signal | Instrument | Bar to clear |
|---|---|---|
| New information (H1) | Y/N did-you-know, per recipient | ≥50% of cards land ≥1 "didn't know" |
| Actionability (H1) | Y/N would-change | ≥1 "would change" on ≥40% of cards |
| Face-threat (H2) | 1–5 rating, A vs B | Variant B ≤ Variant A, and B ≤ 2 on average |
| Timing (H3, OV-3) | wizard-write latency | median < ~60s and card lands pre-decision |
| Trust | "would you want this in your meetings?" | majority yes |

## Decision this unlocks

- **H1 fails** (cards rarely land new/actionable info) → the mediation thesis is unproven; do not
  build toward live mediation. Revisit scope (this is the strongest signal to have early).
- **H1 holds + H3 holds** → live-mediation frame is validated; proceed down PRD §17.
- **H2 result** → sets the default card shape (bank into PRD §9.2 as the canonical rhetoric).
- **H1 holds but retention/solo value is the open question** → combine with a Phase-2 solo-retention
  read to settle **D1** (solo-first). D1 stays held until both are in.

## Recruiting script (paste-ready)

> Hi [name] — I'm testing a small idea and want 30 min of a real meeting you already have this
> week. Falcon is an AI teammate that, during a meeting, quietly writes a short note when it spots
> something the room is missing — backed by a real PR/issue/decision, never guessing, never spoken
> out loud. For this test *I'm* the AI (no software yet). I'd read your team's recent work
> beforehand, sit in on the meeting, and DM a note or two if a gap comes up. Afterward, 5 quick
> questions. No recording is kept. Up for it?

## Guardrails (keep the test honest)

- **Every card cites a real artifact.** No citation → no card. This is Gate 3, tested by hand.
- **Nudge-only for performance-adjacent facts** (PRD F9.2a) — never a card that reads as blame.
- **No card spoken aloud** — text only, into a side channel.
- **Consent:** tell participants a human is observing and taking notes; keep no recording. (The
  consent/recording questions for the *productized* version are in
  [`legal-brief-capture-consent.md`](./legal-brief-capture-consent.md) — not needed for a
  human-observer WoZ, but don't let the WoZ set a precedent that skips them later.)
