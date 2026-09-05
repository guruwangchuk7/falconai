# Pilot Feedback — Round 1: Synthesis, Repositioning & What to Solve

_Compiled 2026-09-05. Source: 7 persona reviews of the `/falcon` walkthrough + pitch (senior SWE, founder CEO, CTO, journalist, marketing manager, freelancer, freelancer-broad-integration). Full signal log in memory `project-pilot-feedback-round1`._

> **Headline:** Across 7 maximally-different personas, the convergence is airtight and there are **zero contradictions**. Two conclusions dominate:
> 1. **Decision Memory + traceable evidence is the product (and the moat) — and you already built most of it.** You are pitching the commodity ("personal AI that remembers your PRs") and hiding the defensible product ("what your team decided, why, whether it's still true, and proof").
> 2. **The current positioning is a market ceiling.** 6/7 rejected the engineering framing; 3/7 would have left the landing page before discovering the value applies to them.

---

## Part 1 — The Repositioning (Item A — free, highest leverage, do first)

### Kill these three things
| Remove | Why (who) | Replace with |
|---|---|---|
| "**personal** AI" | 4 personas: once you connect company GitHub/Linear/Notion it's team/company infrastructure, not personal. Non-eng personas hear "not for me." | "your team's memory" / "your work memory" |
| "remembers **everything you've shipped**" | 6 personas: "shipped" = dev-only signal (journalist/marketer/founder bounce); "everything" over-promises and cracks the moment it misses one deleted ticket / Slack decision. | "what you discussed, decided, promised, and shipped" |
| "**no hallucinations**" | 3 personas (eng, founder, CTO): unfalsifiable + dangerous in a probabilistic system; false confidence on a *decision* is worse than "I don't know." | "every answer is **traceable to its source**" |

### New one-liner — recommended
> **Falcon is your team's work memory — it remembers what you discussed, decided, promised, and shipped, and shows you the receipts.**

The four verbs (**discussed / decided / promised / shipped**) are deliberate: they span all 7 personas' domains in one line — code, campaigns, client calls, interviews — without naming any tool.

### Alternates (by context)
- **Shortest:** _Your work memory, with receipts._
- **Emotional hook (freelancer's line):** _Your work remembers everything. Falcon helps you remember it._
- **Buyer/CTO framing (leads with the moat):** _Falcon knows what your team decided, why, and whether it's still true — and can prove every part._

### The promise that earns trust (use everywhere)
> **"I remember — and I can show you exactly where it happened."**

Receipts/auditability is the single most-praised idea across all reviews. It is what turns "another AI search box" into something this crowd trusts. Lead with the mechanism, not the magic.

### Sub-lines per audience (same product, different noun — landing page rotator / segment pages)
- **Engineer:** _"Why did we choose Kafka over SQS — and did we ever change it?" Answered, with the PR and the decision doc._
- **Founder/CTO:** _"Why did we postpone SSO?" Recover the decision, the reasoning, and who made it — without interrupting the team._
- **Marketing:** _"Why did we stop running LinkedIn ads?" The decision, the performance report, the date._
- **Freelancer/consultant:** _"What did the client agree to?" Prove exactly what was decided, on which call._
- **Journalist:** _"What did she say about Europe in our last three interviews?" With the exact transcript passage._

### Reframe the walkthrough (the founder's free experiment)
Current demo leads with _"what did I ship?"_ — the weakest, most-commoditized query. **Lead instead with a Decision-Memory "why did we decide X?" moment**, which was every persona's "oh, this is actually different" moment. Suggested 60s reorder:
1. Cold open on the pain: _"Why did we decide not to do X six months ago?" — nobody remembers._
2. Ask Falcon that question → grounded answer + **click straight to the source**.
3. Show the **superseded** state: _"this decision was later changed in August."_
4. One line on the boundary: _"Falcon only answers from what you can actually access, and only from real sources — no source, no answer."_
5. Close: _"It remembers what you decided — and shows you where."_ Then the 5 questions, Q4 unchanged.

---

## Part 2 — What the reviews said (compressed)

### The 8-point convergence (all 7 personas, independently)
1. **Decision Memory / decision lineage is the hero** — and per the CTO, the *only* defensible moat. "What did I ship" is commodity/reconstructable from GitHub and will be crushed by incumbents (Linear/Notion already ship workspace AI Q&A).
2. **You already built the defensible product** — `what / why / valid-or-superseded / provable` ≈ Decision Records (F10) + provenance-gated grounding + freshness/recency-weighting. Gap is **framing + a few reasoning/UX surfaces**, not core capability.
3. **Market "traceable + uncertainty-aware," never "no hallucinations."**
4. **ACL / permission-inheritance / offboarding is a hard gate** they will *actively red-team* (founder + CTO + both freelancers). "Search permission ≠ permission to expose via AI." Capability exists (RLS + per-source ACL + publish-time intersection); it is **not surfaced or provable**.
5. **Freshness / supersession / temporal is a top technical priority, not polish.** "Stale memory = an organizational misinformation system" (CTO).
6. **Infrastructure, not a dashboard.** Anti-dashboard, zero-maintenance, zero-behavior-change, one query box that hides the integrations.
7. **The real competitor is the existing stack** (GitHub/Slack/Notion search + ChatGPT) and incumbents converging. Falcon wins only on cross-system "why / what-changed / still-valid" questions with proof.
8. **The tech is broader than the pitch** — Decision Memory is **source-agnostic** (validated across code, campaigns, client calls, interviews). Willingness-to-pay rises with **capture breadth** (freelancer: GitHub+Linear 8/10 → +Gmail/Docs 9/10 → +Calendar/meetings 9.5/10 "daily"). **Gmail is the highest-leverage next source.**

### Adoption board
| # | Persona | Adoption | Hero query | Ceiling / blocker |
|---|---|---|---|---|
| 1 | Senior SWE | 8/10 | "why Kafka vs SQS, did we change it?" | silent inaccuracy / stale index |
| 2 | Founder CEO | 7/10 | "why did we postpone SSO?" | "personal" framing; ACL |
| 3 | CTO | 7/10 | decision **lineage** (the moat) | freshness; ACL red-team; admin/audit |
| 4 | Journalist | 5/10 | "what did she say in past interviews?" | eng positioning (would bounce) |
| 5 | Marketing Mgr | 6/10 | "why did we stop LinkedIn ads?" | eng positioning; source-context |
| 6 | Freelancer | 8/10* | "what did the client agree to?" | *needs meeting-transcript capture |
| 7 | Freelancer (broad) | 8→9.5/10 | "what did I promise / what's blocked?" | integration breadth; per-client ACL |

Non-eng scores are capped by **positioning, not value** — each says "if it spoke to my domain, I'm in."

---

## Part 3 — Crucial changes, ranked (what to solve)

### Tier 0 — Reposition (free, unblocks the market) — **DO FIRST**
See Part 1. Copy + walkthrough only; no code risk. This is the highest ROI action in the entire round.

### Tier 1 — Surface what you already built (cheap; converts skeptics)
These are UI/copy exposures of shipped capability, not new systems:
- **Show decision state in answers** — `superseded` / freshness ("changed in August", "as of your last sync") is in the data (F10.1, `dataAsOf`); render it. Directly answers the CTO's #1 technical fear (stale = misinformation).
- **Make ACL explicit + demonstrable** — a short "what Falcon can and can't see" statement + the ability to *prove* it (see Tier 2 red-team test). This is a *selling point you're hiding*, and a dealbreaker for 3 buyers.
- **Empty-answer & window honesty** — replace "nothing found" with "searched your GitHub PRs + Linear from Jan–Sep, found no evidence X was completed." Cheap; it's exactly what earns the skeptic (Tester #1's failure mode).

### Tier 2 — New builds, ranked by convergence weight
1. **Transcript paste → decision extraction (web-only)** ⭐ — reuses the *shipped* extraction engine (feature 005), needs no desktop app/mic, fits pilot v1, and unblocks 3 personas (freelancer 8→, journalist, marketer). **Highest new-value item.**
2. **Confidence / source-context tiers** — "Confirmed: PR merged May 12" vs "Likely, from 3 artifacts"; "official decision vs random Slack comment." Wanted by eng + CTO + marketer. Aligns with the traceability repositioning.
3. **Temporal family** — parse multi-month/quarter ("last 3 months"), "what changed since January?", point-in-time ("as of June 1"), scope-change. Wanted by eng + founder + CTO + freelancer. (Start with the cheap multi-month parser + honest window boundary — Tester #1's exact failure.)
4. **Commitment tracking** — "what did I promise that isn't done?" / "what's blocked?" Freelancer's killer query; Branch-A memory feature.
5. **Evidence-expansion panel** — source + passage + date + author + type, not just a link (so a 400-comment PR isn't a scavenger hunt). Eng + journalist.
6. **Decision timeline / lineage view** — Jan→Mar→May progression ("project memory graph"). Founder + CTO + marketer + freelancer.
7. **Per-client / project scoping** — hard boundary + "delete a client's entire history," a sub-tenant dimension for solo users. Freelancer (catastrophic if broken).
8. **Admin / audit surface + provable ACL red-team** — connected sources, indexing status, retention, deletion, **audit log** (retroactively justifies the decided-but-absent `audit_log` table), disconnect-a-source. CTO enterprise gate.

### Tier 3 — Roadmap (validated demand, not pilot-blocking)
- **Gmail integration** — the demand-slope's highest-leverage next capture source.
- **Calendar / meeting context**, then the rest of the source-agnostic capture roadmap.
- **Misleading-signal handling** (reverted / partial migrations / abandoned tickets) — hard; the "migrated in April but only partial" danger case.

---

## Part 4 — The problems to solve, stated plainly
1. **Discovery problem (positioning):** the right users leave before seeing the value. → Tier 0.
2. **Trust problem (skeptic's bar):** answers must be concise, cited, clickable, and *honest about limits* (empty results, window, confidence) — silent completeness loses this crowd. → Tier 1 + Tier 2.2/2.3.
3. **Freshness problem:** a confidently-served stale decision is worse than no answer. → Tier 1 (surface superseded/freshness) + Tier 2.3.
4. **Security problem (buyer's gate):** ACL must be provable and respected at the source, incl. offboarding + per-client isolation. → Tier 1 (surface) + Tier 2.7/2.8 (prove + admin).
5. **Completeness problem (capture coverage):** Decision Memory is only as good as what gets captured; decisions live in meetings/email, not just GitHub. → Tier 2.1 (transcript paste) now → Tier 3 (Gmail/Calendar).
6. **Defensibility problem:** integrations are table stakes; the moat is decision lineage + temporal + evidence + retrieval accuracy. → make it the product (Tier 0) and invest in Tier 2.2–2.6.

---

## Part 5 — Recommended sequence
1. **Tier 0 reposition** (copy + walkthrough) — this week, before any more tester outreach.
2. **Tier 1 surfacing** (superseded/freshness in answers, honest empty-answers, ACL statement) — small, high-trust.
3. **Tier 2.1 transcript-paste → decision extraction** — the flagship new build; reuses shipped code; unlocks non-eng + freelancer daily use within web-only v1.
4. **Tier 2.3 (cheap slice) multi-month parse + honest window** — closes Tester #1's exact failure.
5. Then Tier 2.2 (confidence), 2.5 (evidence panel), 2.6 (timeline) as capacity allows — each earns a specific persona.
6. Tier 3 (Gmail) is the next growth investment once v1 signal confirms.

_Everything in Tier 0/1 and 2.1/2.3 is memory-layer-first (per the roadmap: fix/integrate the memory layer before any Phase-4 mediation work). None of it depends on the desktop app or live mic._
