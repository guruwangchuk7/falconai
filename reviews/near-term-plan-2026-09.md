# Near-term plan — reprioritized on real user feedback (2026-09-01)

**Status:** proposed (Guru to approve/adjust). **Trigger:** first real user testing of the Phase-3
desktop demo. **Supersedes** the "finish Phase 3 → 4 first" default ordering for the near term.

## What we learned (2 testers, one signal)

- **The live transcript has no standalone value.** ("No use of voice-to-text.") The PRD agrees —
  §1: *"the pitch is NOT 'AI takes notes.'"*
- **The value is Falcon *knowing your work and remembering/surfacing it*** — decision history, "why
  did we decide X," pre-meeting context, commitment tracking, "what are we missing."
- **6 of the 8 requested features are the memory/knowledge layer**, which sits on **Phase 1 (context)
  + Phase 2 (personal Q&A) — already shipped** — NOT the live Phase 3→4 mediation.
- Privacy bug (raw transcript shown to others) — **fixed** (PR #18).

**Implication:** ship the memory layer on the shipped foundation to real users *now*; keep live
mediation (Phase 3→4) on the roadmap but not as the near-term priority. Ship-and-learn weekly; the
roadmap is a hypothesis, and we now have data.

## The plan (≈4 weeks, weekly ships to the warm engineers)

### Sprint 1 (week 1–2) — the moat: Decision memory + "Why?" Q&A
The highest-value, most-defensible, closest-to-shipped slice. Delivers tester wants **#1, #4, #8**.
- **Decision Records (F10.1)** on the web dashboard: capture a decision (what / why / who / when /
  which source), the `unconfirmed → confirmed → superseded` lifecycle (only confirmed are
  retrievable), linked to source artifacts. Bootstrap without meetings: **manual capture + extract
  candidate decisions from synced PRs/Linear.**
- **"Why?" grounded Q&A**: extend the shipped Phase-2 answer core to query the Decision Index —
  "why did we decide to delay the launch?" → grounded, cited answer. Reuses `@falcon/core/answer`
  (provenance gate already built).
- **Deploy to the engineers.** Web app + these features on a **$0 host (Oracle Cloud always-free VM)**
  or cheap Fly. This unblocks the deploy that funding was stalling — no Fly cost required.
- **Exit signal:** do the engineers *return* to ask Falcon "why/what" questions? (retention)

### Sprint 2 (week 3–4) — Pre-meeting briefing + commitment tracking
Tester wants **#6, #2**.
- **Pre-meeting briefing (extends F3 Context Pack, now user-facing):** before a calendar meeting,
  Falcon shows last decisions, unresolved threads, open PRs/tickets, and what people committed to.
- **Commitment tracking (F10.2/F10.3):** extract commitments ("I'll send X by Friday") from synced
  activity (and, later, the transcript we now have) → track → flag if overdue. Reuses the
  Linear/Jira draft path.
- Iterate Sprint 1 based on real usage.

## Deferred (on the roadmap, not now — with why)

- **Live mediation cards (Phase 3 US2/US3 → Phase 4).** Still the crown jewel, but users pointed at
  memory first, and it's weeks of work toward a not-yet-validated "cards help live" thesis. Build it
  once the memory layer has traction *and* there's signal people want the live layer.
- **Desktop distribution / two-person live pairing.** The plumbing works (validated). Revisit when the
  live layer is the priority; needs installer + hosting.
- **Falcon Pulse (#3), "What are we missing?" (#5).** Valuable extensions; sequence after the moat lands.

## Open decision for Guru

- **#7 "AI teammates that take ownership / auto-create tasks"** — a tester wants this, but it
  **conflicts with the non-negotiable** *"Falcon proposes; humans dispose — it never executes
  actions"* (action items are one-click drafts). Decide deliberately: hold the line (drafts only), or
  amend the principle (and update the PRD + constitution). **Recommend: hold the line for now** — the
  human-in-the-loop trust property is a differentiator; revisit if users push hard.

## Principles carried forward
- Roadmap = hypothesis; user feedback bends it continuously.
- Ship the smallest valuable slice → learn → adjust. Weekly cadence while finding fit.
- Build on the shipped foundation (Phase 1/2) before net-new phases.
- Every feature still obeys the constitution (grounded-or-silent, tenant isolation, human-in-the-loop).
