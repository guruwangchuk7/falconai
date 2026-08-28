# Email draft — privacy/tech counsel, capture-consent read

Paste-ready. Attach [`legal-brief-capture-consent.md`](./legal-brief-capture-consent.md). Keep the
ask bounded so it's a fast, cheap read, not an open engagement. The two questions that gate a
product decision are **A3** and **B6** — everything else is context.

---

**Subject:** Scoped 2-hour read — recording-consent + biometric exposure for a meeting-AI product

Hi [Name],

We're building **Falcon**, a workplace meeting assistant. Each participant runs a lightweight app
on their own device that captures **only their own microphone**; audio is transcribed in real time
in the cloud and the raw audio is discarded (only the transcript stream is processed). Falcon never
speaks — it writes short, text-only notes to participants. We want a **bounded read (≈2 hours)** on
our exposure *before* we finalize the consent design, not a full engagement yet.

I've attached a short brief with the full question set. **Two questions gate a product decision** —
if you only have time for these, they're the ones:

- **A3 — Consent record for the non-consenting party.** An installed user consents in-app. Someone
  they're meeting with may have no app and give no direct consent; today the design relies on the
  installed user having told them. **Is a self-attested "I told them" a defensible consent record
  for that non-consenting party** in all-party-consent states (CA, PA, IL, FL, WA)? If not, what's
  the minimum that is?

- **B6 — Consent scope for group disclosure.** Consent today is captured **pairwise** (per person,
  at pairing). But Falcon can surface one person's input to the **whole group**. **Is pairwise
  consent legally sufficient for group disclosure, or must consent be session/group-scoped** and
  re-affirmed when the set of people present changes?

Context that shapes both: participants are often in **different states** (which jurisdiction's rule
governs?), and there's a distinct **biometric** angle — even discarding audio, does cloud voice
processing implicate voiceprint law (Illinois BIPA, TX CUBI, WA)? Those are in the brief (A4, B6-adjacent).

Our provisional plan if the read on A3/B6 is adverse: drop the system-audio fallback entirely and
move consent from pairwise to **session/group scope**, re-affirmed when attendance changes. We'd
like your view on whether that's sufficient, or whether there's a cleaner defensible line.

Could you take the scoped read and send back: (1) the A3/B6 answers, (2) the single biggest
exposure you'd flag, and (3) whether the session-scope fix above closes it? Happy to do a 30-min
call after.

Thanks,
[Guru]

---

**Enclosure:** `legal-brief-capture-consent.md`
