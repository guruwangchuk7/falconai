# In-Meeting Decision Listener — state of play

**Status:** ✅ **SHIPPED — merged to `main` 2026-09-03** (PR #25, merge commit `e37a5e6`). Feature 005 / spec `docs/superpowers/specs/2026-09-02-in-meeting-decision-listener-design.md`. This doc is the single place to re-acquire the thread; it summarizes and points at the authoritative artifacts (design doc, PRD §21, security inventory) rather than duplicating them.

## What it does
A finished paired meeting → **post-meeting** extraction → drafted, cited, **UNCONFIRMED** Decision Records in the existing `/decisions` queue, with a two-tier confidentiality model. Falcon writes; it never speaks.

## Proven vs. unproven (read this before a pilot)
- ✅ **The pipe carries speech, live.** Real mic → Silero/energy VAD → Deepgram STT → Redis event log → meeting-end → assembly → Claude extraction → cited unconfirmed card. Verified end-to-end with real speech on 2026-09-03.
- ✅ Two-tier privacy enforced end-to-end (see security inventory). Fresh-DB `0001→0010` comes up clean from zero.
- ❓ **Extraction on *real conversation* is UNPROVEN.** What was tested live was one speaker, one clean utterance, one unambiguous decision. The cases the design is built around — intra-meeting reversal (D1), overlapping speech, rationale sitting minutes from the decision (D4) — have NOT been through real audio. That is the pilot-standup test.

## The D1–D15 decisions (as built)
Full rationale in design doc §3. As-built status:

| # | Decision | As built |
|---|---|---|
| D1 | Post-meeting extraction, not live | ✅ |
| D2 | Land in the existing unconfirmed queue | ✅ |
| D3 | End-of-meeting delivery moment (near-zero-effort confirm) | ✅ (in-app; the two-button confirm keeps it one click — see D13 note) |
| D4 | Citable unit = extractor-selected spans | ✅ (`decision`/`rationale` spans, index-referenced) |
| D5 | Excerpt lifetime = candidate lifetime (dismiss deletes spans) | ✅ |
| D6 | Opt-in full-transcript retention (default-off, 7–14d) | ✅ + **TTL now enforced by a reaper** (was a promise with no enforcement) |
| D7 | Durable working copy at session end (24–72h), idempotent `{workspaceId, meetingId}` | ✅ |
| D8 | Trigger = explicit end + idle-grace + cap | ✅ (idle grace env-configurable; ran pilot/test at 6s) |
| D9 | Index-referenced spans (model points, we own timestamps) | ✅ |
| D10 | Two-tier visibility — summary follows tier, verbatim always attendee-gated | ✅ (DB RESTRICTIVE policy on spans) |
| D11 | Reserved lane inside the workspace budget pool | ✅ |
| D12 | Decision-visibility = current membership; span-visibility = snapshotted attendees | ✅ |
| **D13** | Per-record visibility tier, explicit at confirm; widening one-way | ✅ **but REFINED past the brainstorm text.** Original said "`workspace` pre-selected." That scroll-past default was a leak: it let a client decision be filed workspace-wide because nobody picked, and the draft was even workspace-visible in the queue *before* confirm. As built: meeting decisions are created with **visibility NULL (unchosen)**; the queue is viewer-tier-gated so non-attendees don't see drafts; confirm is **two buttons** (`Confirm for team` / `Confirm — attendees only`), no default; the write-gate refuses a NULL-visibility confirm. |
| D14 | Owner attribution is a low-confidence hint | ✅ (UI does not present it authoritatively) |
| D15 | Cross-tier supersede is status-visible, never citable | ✅ |

## Open items (documented, NOT built) — with triggers
Full text in **PRD §21 items 12 & 13**.
- **Item 12 — client vs. internal decisions.** Confidentiality (visibility tier — solved) vs. context bleed (needs engagement "spaces" — deferred until real usage tells us the shape; confirm whether client work is even in the pilot). **Sub-gap:** a PR-mined decision from a client's private repo carries no tier and lands `workspace` — same hole, different door.
- **Item 13 — the multi-workspace user.** A `session` carries one `workspace_id`; a multi-workspace user can have a meeting filed under the wrong org, and RLS does NOT guard it. Needs a host rule + explicit workspace pick + "Recording into: X" indicator. **TRIGGER (named): the moment any pilot participant belongs to a second workspace, this stops being deferrable and becomes ship-blocking before that person captures.**

## The bug worth remembering (a class, not an incident)
**Fenced JSON.** Haiku wraps its JSON in a ```` ```json ```` fence; a bare `JSON.parse` throws; extraction returns `[]`. It was invisible because "extraction returned nothing" and "no decisions were made" are the **same `no_decision` ledger row**, and every test double emitted cleaner (unfenced) JSON than the real model. Fixed structurally: one shared `sliceJsonObject`, the offline fake now fences by default, the sibling PR-miner parser was fixed too. **A test double cleaner than the thing it doubles is a test that can only pass.**

## Post-merge work
1. ✅ **Silent-zero alarm (branch `feat/listener-silent-zero-alarm`)** — `checkSilentExtractionStreak` + hourly worker maintenance job: alerts (Sentry) when a workspace's last `DECISION_MEETING_SILENT_STREAK` (=8) extractions are ALL `no_decision`. A real decision resets the run, so normal cadence never trips it; a systematic break climbs. Would have caught the fenced-JSON bug in one meeting.
2. ⏳ **Calibrate `DECISION_MEETING_MIN_CONFIDENCE`** (still a guess, 0.75) on a **labeled meeting corpus** — the real merged→pilot-ready gap, and why the opt-in retention setting (D6) exists. Blocked on collecting the corpus.

## Where to look
- Design + D1–D15 rationale: `docs/superpowers/specs/2026-09-02-in-meeting-decision-listener-design.md`
- Security posture (what's enforced vs. intended, pinned to a commit): `docs/security-claim-inventory.md`
- Open questions register: `PRD.md` §21 (items 12, 13) + §14 data-model note
