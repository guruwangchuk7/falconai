# Falcon — Funding Support Request

**Prepared for:** Dabtong House · **Prepared by:** Guru Wangchuk, Falcon
**Date:** 30 August 2026 · **Stage:** Phase 1 + Phase 2 shipped; entering a real-user pilot

---

## 1. What Falcon is

Falcon is a **personal AI that remembers your work.** It reads each engineer's GitHub history — their
pull requests, issues, and decisions — and gives them the exact context they need, grounded in the
real source, the moment they need it: for standups, code reviews, and handoffs. Every answer shows
its source, and if Falcon can't ground an answer in real work, it says so rather than guessing. Over
time it grows into a shared layer that helps whole teams during meetings.

We are built and shipping in **Thimphu, Bhutan**, for a global market.

## 2. The team

We are a **small team of three people.** We have already, with heavy use of AI development tools,
shipped two full phases of the product:

- **Phase 1 (Context Layer):** securely connects to each user's tools, syncs their work, and enforces
  strict per-company data isolation — proven with automated tests on a real database.
- **Phase 2 (Personal Falcon):** the private, grounded question-answering product, now validated on
  real data. In our own testing it produced accurate, cited answers and a clear "yes, I would use this
  weekly" signal.

We now have **5–9 engineers who have asked to use it**, and our immediate next step is a hosted pilot
to put it in their hands.

## 3. Why we need funding

A three-person team punching above its weight relies on two things: **AI tools that multiply each
person's output**, and **cloud/AI services that run the product for real users.** Both are recurring
costs that a pre-revenue team cannot yet self-fund. Support here directly converts into shipping speed
and into the first real-user validation that de-risks everything after.

## 4. Where funding would go (by area)

| # | Area | Why it's needed | Tools / technology | Est. cost |
|---|---|---|---|---|
| **1** | **AI development tools (headline request)** | Our development velocity depends on AI coding assistants — Phase 1 and 2 were built this way. For a 3-person team this is the single biggest force multiplier. | **Claude subscriptions** (Claude Code) for the 3 team members | **~$300–600 / month** for the team (plan-dependent) |
| 2 | **Product AI usage (runtime)** | The product itself runs on AI: it uses Claude to write grounded answers and Voyage to understand and search each user's work. Pilot usage means real API bills. | Anthropic Claude API (answers); Voyage AI (embeddings + search — needs the paid tier so multiple engineers can sync without rate limits) | ~$20–100 / month at pilot scale |
| 3 | **Cloud hosting & infrastructure** | To let engineers reach Falcon on the internet (today it only runs on our machine), we need hosting for the app and its background worker, plus the database and cache. | Fly.io (app + worker), Supabase (database), Upstash (cache), Cloudflare (landing page) | ~$15–50 / month |
| 4 | **Legal / compliance (one-time)** | Falcon handles work data and, in later phases, meeting audio. A short privacy-lawyer review of our consent approach protects users and the company. | Privacy counsel review (consent & data handling) | ~$500–2,000 one-time |
| 5 | **Future phases (for context, not immediate)** | The roadmap adds live meeting support, which needs speech-to-text. Listed so the full picture is clear; not required for the pilot. | Deepgram / AssemblyAI (speech-to-text) | usage-based, later |
| 6 | **Operational essentials** | Domain, business email, and design assets for a credible product. | Domain, email, design tools | ~$10–30 / month |

## 5. Headline request — Claude subscriptions for 2–3 months

**We specifically request funding support for Claude subscriptions (Claude Code) for our team of
three, for the next 2–3 months.**

- **Why:** we are a very small team, and AI-assisted development is how three people ship at the pace
  of a much larger one. Our entire codebase so far was built this way. Sustaining these subscriptions
  through the pilot keeps our development and productivity high exactly when we're putting the product
  in front of real users.
- **What it covers:** Claude subscriptions for 3 team members (the exact plan/tier to be confirmed
  against current pricing — Pro, Team, or Max depending on usage).
- **Estimated amount:** roughly **~$300–600 / month for the team**, i.e. **~$600–1,800 total for
  2–3 months.** (We are happy to right-size the plan to whatever level of support is available.)

## 6. Summary of the ask

| Priority | Item | Timeframe | Estimated support |
|---|---|---|---|
| **1 (requested now)** | **Claude subscriptions for the 3-person team** | 2–3 months | **~$600–1,800 total** |
| 2 | Product AI usage (Anthropic + Voyage) | pilot (2–3 mo) | ~$40–300 total |
| 3 | Hosting & infrastructure (Fly/Supabase/Upstash) | pilot (2–3 mo) | ~$30–150 total |
| 4 | Privacy-counsel review | one-time | ~$500–2,000 |

**Indicative total for a 2–3 month pilot:** on the order of **~$1,200–4,000**, of which the **most
important and time-sensitive is the Claude subscription support** that keeps our small team
productive.

## 7. What this funding unlocks

With this support we will, within the next 2–3 months: deploy Falcon to a public URL, onboard the
5–9 engineers already waiting, and gather the first real-world retention data — the evidence that
tells us (and any future backers) whether to invest in the next phase. It is a small amount of money
that buys a disproportionately large amount of validation.

*All cost figures are honest estimates and should be confirmed against current provider pricing at
the time of purchase. We are glad to adjust scope to match the support Dabtong House is able to offer.*
