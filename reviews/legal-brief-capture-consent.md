# Legal brief — capture consent, recording law, biometric exposure

Prepared for: an outside tech-privacy attorney · Requested by: Guru · 2026-08-28
Purpose: a fast, scoped read on recording/consent exposure before it's designed into the product
or hit during an enterprise deal. Not legal advice; this is the fact pattern + the questions.

## What the product does (facts that matter)

Falcon is a desktop app. Each participant in a meeting installs it; the app captures **only that
person's own microphone**, transcribes it in the cloud (Deepgram/AssemblyAI), and merges the
per-person transcripts into one attributed transcript. Attribution is by device, not by
voiceprint. Meetings can be remote (Zoom/Meet/Teams) or in-person.

Two capture modes are in question:
1. **Paired capture (default):** every speaker has installed the app and is capturing their own
   mic. Each installed user sees a one-time consent card the first time they pair with another
   person, and an always-visible capture indicator.
2. **System-audio fallback (the item under review, proposed for removal):** when someone in the
   meeting has **not** installed Falcon, an installed user can enable capture of system/speaker
   audio, which records the **non-installed person's voice** off the local speakers. That person
   has no app, no UI, and gives no direct consent; today the spec relies on the installed user
   being told to "inform people in the room."

Data handling: raw audio is not stored (transcription stream only); transcripts are retained per
workspace policy; **Decision Records** (structured meeting outcomes, including named dissent,
owners, and quoted positions) are retained **effectively indefinitely** and embedded into a
searchable index. Participants may be in different physical jurisdictions (remote, travel, VPN).

## Questions

### A. Recording / wiretap consent
1. In all-party-consent (two-party) states (e.g. CA, PA, IL, FL, WA), does real-time cloud
   transcription of a **workplace meeting** constitute "recording" of an "oral/confidential
   communication," given that raw audio is not persisted but a transcript is?
2. Does the **paired** mode (each person captures their own mic, sees an indicator, one-time
   consent) satisfy all-party consent for a routine internal meeting? Is per-meeting notice
   required, or is standing consent adequate?
3. Does the **system-audio fallback** — capturing a non-installed person's voice with only the
   installed user's self-attestation that they "informed the room" — create wiretap exposure?
   Is a self-attested "I told them" a defensible consent record for the non-consenting party?
4. When participants are in **different states/countries**, which jurisdiction's consent rule
   governs, and how should the product determine each participant's *physical* location (which we
   cannot reliably obtain)?

### B. Biometric (BIPA and analogues)
5. Falcon attributes speech **by device**, not by voiceprint. Does any part of the pipeline
   (device-based attribution, cloud STT, storing transcripts tied to a named speaker)
   nonetheless implicate **voiceprint/biometric-identifier** law (Illinois BIPA, TX CUBI, WA)?
6. Would the removed system-audio fallback — capturing and attributing a non-user's voice —
   change that answer (i.e., does attributing an un-enrolled third party's voice create a
   biometric-identifier obligation the paired model avoids)?

### C. Consent scope and lifecycle
7. Consent is currently modeled **pairwise** (user A ↔ user B), but a shared "mediation card"
   discloses each person's input to the **whole group**. Is pairwise consent legally sufficient
   for group disclosure, or must consent be **session/group-scoped** and re-affirmed when the
   participant set changes?
8. Is **capture consent** distinct from **storage/retention consent** for the indefinitely-kept,
   embedded Decision Records that contain personal data?

### D. Data-subject rights
9. For **erasure/GDPR-style** requests (a departed employee, or a non-consenting party captured
   via fallback): what are the obligations to remove personal data from an indefinitely-retained,
   embedded, supersede-linked Decision Index, and does "transient" transcription change them?

## The decision this unblocks
If the read on A3/B6 is adverse, the recommendation (already provisionally accepted in review) is
to **cut the system-audio fallback from v1** and keep only paired capture — which also preserves
the attribution-without-voiceprint architecture and gives a clean "we do not capture non-users"
answer in enterprise security reviews. The consent-scope fix (C7, pairwise → session) and the
erasure design (D9) proceed regardless of the fallback decision.
