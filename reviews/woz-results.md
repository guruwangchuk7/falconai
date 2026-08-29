# WoZ results log — grounded mediation cards

Running log for the Wizard-of-Oz test (`woz-test-plan.md`). Copy the **Session template** block
per meeting. Roll the totals up in the scoreboard as you go. You are the wizard: read each
participant's recent PRs/issues beforehand, prep 2–3 candidate cards (each MUST cite a real
artifact — Gate 3 by hand), and DM one card at the moment a gap/contradiction surfaces. Never
spoken aloud. Debrief with the 5 questions right after.

---

## Scoreboard — 3 teams (1 qualitative + 2 instrumented, n=10 people). Consistent.

| Signal (hypothesis) | Bar to clear | Running result |
|---|---|---|
| New info — "didn't know" (H1) | ≥ 50% of cards land ≥1 | **Met** — both instrumented cards: 4/5 didn't fully know |
| Actionable — "would change" (H1) | ≥ 40% | **Met — 80% both teams** (only the one person who already knew said no, each time) |
| Face-threat — Variant B vs A (H2) | B ≤ A, and B ≤ 2 | **Met decisively** — A avg 3.6, B avg 1.0 (identical across both instrumented teams); B preferred by all 10 |
| Timing — latency (H3/OV-3) | < ~60s, pre-decision | **⚠ THE RISK** — team @ ~48s = fine; team @ ~61s median = multiple "too slow" complaints. Fails as latency approaches/exceeds 60s |
| Trust — "want this in meetings" | majority yes | **Met** — 5/5 (team 1 instrumented); positive (qualitative); not captured (team 2) |

**Decision gate:** H1 fails → mediation thesis unproven, stop building toward live mediation.
H1 + H3 hold → proceed down PRD §17. H2 → sets the default card shape. Pair with a Phase-2
solo-retention read to settle **D1**.

---

## Session 1 — Team 1 — early signal (qualitative; NOT proof — n=1)

**Core problem confirmed = memory/context.** People don't see/remember every GitHub issue/PR;
weekly (vs frequent) meetings → more forgetting. They saw value in Falcon bringing old context back
*at the right moment*. → **H1 positive.**

**Liked the sidebar** — a Falcon message in a window during the meeting; wants it straightforward,
easy to read.

**Wants a pull mode, not just push.** They want to *ask* Falcon: "What work was completed in
GitHub?", "What happened with Feature X?" → product discovery: **proactive cards + private Q&A over
project history** are two modes worth testing. (Currently PRD is push-only.)

**~1-minute latency is too slow (H3 NOT met).** They'd prefer Falcon to listen and answer live /
near-real-time. This challenges the async-write frame — a card that lands a minute later misses the
moment. Architecture implication: near-real-time path, not batch.

**They asked the pivotal question: "One shared Falcon, or does everyone have their own?"** This is
**D1** (solo-first) surfacing organically from users.

**A vs B is conditional on the privacy model (refines H2):**
- **Variant A (asymmetric, "Sarah didn't know X")** fits a *shared/team* Falcon helping the whole
  group — but calls a person out.
- **Variant B (symmetric, "there's a prior abandoned impl due to perf")** fits *personal/private*
  Falcons — each person's Falcon privately fills their gap without publicly naming who didn't know.
- → **Finding:** preferred card shape depends on shared-vs-personal architecture. Personal Falcon
  makes blame-neutral symmetric cards especially attractive. Ties H2 directly to D1.

**Honest status after Team 1:** H1 positive · H2 positive-for-B (conditional on privacy model) ·
H3 not met (~60s too slow, want live) · new product thread: personal Falcon + private Q&A. Nothing
"proven" — n=1, qualitative. Next: run more teams, capture per-recipient Y/N + face-threat numbers,
and probe the shared-vs-personal preference explicitly.

---

## Session 2 — Product Engineering Team — instrumented (n=5)

> NOTE: your notes labeled this "Team 1 conclusion." Confirm whether this is the *same* team as
> Session 1 (detailed capture) or a *separate* team — it changes the team-count. Latency sentiment
> differs (Session 1 said ~60s too slow; here ~48s was "good"), which suggests different teams.

**Card shown (shared/group card):** "Related context: a previous implementation of X was abandoned
in PR #123 because of performance issues. Source: PR #123." Meeting: "Should we build Feature X?"

| Recipient | Role | Did you know? | Would change? | Face-threat A | Face-threat B | Latency | Use? |
|---|---|---|---|---|---|---|---|
| Sarah | PM | No | Yes | 4 | 1 | ~45s | Yes |
| Alex | Sr Dev | Partial (knew PR, not the perf issue) | Yes | 3 | 1 | ~50s | Yes |
| Mike | Designer | No | Yes | 4 | 1 | ~55s | Yes |
| David | Tech Lead | Yes | No ("useful for others") | 3 | 1 | ~40s | Yes |
| James | Engineer | No | Yes | 4 | 1 | ~48s | Yes |

**Totals:** didn't-fully-know 4/5 · would-change 4/5 (80%) · **A avg 3.6 / B avg 1.0** · median
latency ~48s (<60s) · use 5/5.

**Reads:**
- **H1 strongly met** — even a senior/tech-lead audience mostly hadn't retained the load-bearing
  fact (*why* it was abandoned), and it would change the decision. David (knew it) still valued it
  for others: "the value is that Falcon remembers things the team doesn't."
- **H2 strongly met** — B beat A for every single person; A read as calling someone out. This is the
  canonical rhetoric for *shared* cards (PRD F9.2a blame-neutral) — bank it.
- **H3 met here** (~48s), but contradicts Session 1's "too slow." Latency tolerance may be
  situational; keep measuring. Even <60s, near-real-time is the safer bet.
- **Q&A ask recurs** — "What did we finish in GitHub last week?" Second team to want pull mode.
- Caveat: this card was a *shared group* card, so the A-vs-B face-threat is evidence about the
  shared model specifically. It doesn't settle shared-vs-personal (D1) — a personal Falcon would
  never show A to the group at all.

---

## Session 3 — Startup/Product Team — instrumented (n=5)

**Card (shared/group):** "Feature Y was previously prototyped but abandoned after users reported the
workflow was too complicated. Source: Issue #87." Meeting: "Should we build Feature Y?"

| Recipient | Role | Did you know? | Would change? | Face-threat A | Face-threat B | Latency |
|---|---|---|---|---|---|---|
| Emma | PM | No | Yes (change scope) | 4 | 1 | ~65s |
| Ryan | Engineer | Yes (built the prototype) | No | 2 | 1 | ~52s |
| Olivia | Designer | No | Yes | 4 | 1 | ~58s |
| Tom | Founder | Partial (forgot the reason) | Yes | 3 | 1 | ~70s |
| Daniel | Developer | No | Yes | 5 | 1 | ~61s |

**Totals:** didn't-fully-know 4/5 · would-change 4/5 (80%) · **A avg 3.6 / B avg 1.0** · median
latency **~61s** · would-use: not captured.

**Reads:**
- **H1 + H2 replicate exactly** (4/5, 80%, A 3.6 / B 1.0) — the effect is now stable across two
  independent instrumented teams. Strong.
- **H3 is failing at the margin.** Median ~61s, and 3/5 explicitly complained ("a minute is getting
  slow," "I'd want this faster"). Latency tolerance breaks right around 60s. **This is the
  load-bearing risk for the live-mediation thesis** — batch/async write is too slow live; the
  product needs near-real-time OR a pull/async frame where latency doesn't bite.
- Daniel (wasn't there when it happened) rated A **5/5** face-threat — the more an outsider you are,
  the more asymmetric framing stings. Reinforces B as default.

## Cross-team synthesis (3 teams)
- **H1: holds.** Forgotten GitHub context is real, load-bearing, and changes decisions. ✅
- **H2: holds decisively.** Symmetric B is the card shape (A 3.6 / B 1.0, unanimous). Bank into PRD
  §9.2. ✅
- **H3: the open risk.** Works under ~50s, fails around/over 60s. Decides architecture: near-real-
  time live path vs pull/Q&A. ⚠
- **Recurring pull-mode ask** (2+ teams want "what did we finish in GitHub last week?") — a Q&A
  frame sidesteps the latency problem entirely and may be the stronger wedge.
- **D1 leaning personal-first:** first team asked directly chose private per-person agents + one
  Coordinator (= the PRD architecture). Confirm in remaining teams (see next session).

---

## Session — Software Engineering Team ("Team 6" in Guru's notes) — PRODUCT DISCOVERY, not a card

Not the mediation-card format (no A/B/latency). A new **mode** surfaced. Scenario: in a standup, PM
asks a dev to explain how they implemented auth and whether it follows the agreed architecture; the
dev finished it but can't immediately explain the details. Dev's own ask:

> "It would be really useful if I could ask Falcon what work I completed and get a summary... 'What
> did I do for authentication, and how does it match the architecture?'"

**New use case: private self-context retrieval — Memory → Understanding → Explanation.** Not "you
finished auth" but "here's *exactly what* you did and *how* it maps to the architecture," grounded
in the artifacts. Value: prep for standups, code reviews, handoffs, technical discussions.

**Reads:**
- **Third independent pull/Q&A signal** (Teams 1, 2, now this) — and the sharpest, because it comes
  with a concrete, high-frequency job (explain your own work on demand).
- **Strongly pro-personal-Falcon (D1):** the whole point is asking *privately* without exposing
  uncertainty to the team. A shared/team Falcon can't serve this.
- **STRATEGIC: this is largely buildable on the EXISTING Phase 1 context layer** (retrieve + LLM
  generate over your own artifacts) — no audio, pairing, or Coordinator needed. It's the closest
  valuable product to what's already shipped, and it has **no latency problem** (user pulls when
  ready), sidestepping H3 entirely.
- The example Falcon answer in the scenario ("Auth.js GitHub provider, callbacks, provisioned
  user/workspace...") is *literally the work done today* — the digest feature is already a coarse
  version of this; a targeted Q&A is a small step from it.

**D1 answered (directly, by this team):** asked shared-vs-personal, they chose **private per-person
Falcon agents + one Main Coordinator**, NOT one shared Falcon (which the earlier 3 teams were
implicitly reacting to via group cards). This is *exactly the PRD architecture* — users arrived at
it on their own. Reads:
- Validates the **personal-agent layer** as where individual value lives (self-context + private
  gap-filling), and users still want the **Coordinator** (shared layer) on top.
- For **D1 (solo-first)**: lead with the personal agent (solo value, buildable on Phase 1, no
  latency issue), add the Coordinator/mediation later. Personal-first, not solo-only.
- Caveat: the earlier 3 teams were never asked the shared-vs-personal question directly (their model
  was *inferred* from group cards). So the direct preference is n=1 team + the recurring personal/
  Q&A asks across teams. Strengthening, not settled — confirm the preference in remaining teams.

---

## Session template (copy per meeting)

### Session N — [team name] — [date] — meeting type: [roadmap / design review / prioritization]
Participants: [names/roles] · Wizard: Guru

**Card 1**
- Variant: [A asymmetric / B symmetric]
- Claim written: "________"
- Cited artifact (Gate 3): [PR/issue/decision link] — no citation → no card
- Moment surfaced at: [time] · Card delivered at: [time] · **latency: __s** · landed pre-decision? [Y/N]

Per recipient debrief:
| Recipient | Did you know? (Y/N) | Would it change what you do? (Y/N) | Face-threat 1–5 | Surprise / quote |
|---|---|---|---|---|
| [name] | | | | |
| [name] | | | | |

**Card 2** (use the *other* variant to A/B within the team if possible)
- Variant: [ ] · Claim: "________" · Cited: [link] · latency: __s · pre-decision? [Y/N]
| Recipient | Did you know? | Would change? | Face-threat 1–5 | Surprise / quote |
|---|---|---|---|---|
| | | | | |

**Team wrap:** "Would you want this in your meetings?" → [Y/N per person]
**Wizard notes:** [what worked, what felt forced, any card you wanted to send but had no citation for]

---
