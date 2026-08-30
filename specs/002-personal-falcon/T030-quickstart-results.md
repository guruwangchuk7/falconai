# T030 — Quickstart V1–V9 results (live feel-pass)

Fill in as you go. App: http://localhost:3000 → **Ask Falcon** (`/falcon`). Real synced data, real AI.
Goal isn't pass/fail on mechanics (the tests already cover that) — it's **does this feel useful?**

| # | What to try | What "good" looks like | Y/N | Notes (what it actually did) |
|---|---|---|---|---|
| V1 | Ask about your **own** real work | A concise answer; every claim shows a source; the source link points to a real PR/commit | **Y*** | *"what are we working on"* → accurate answer (Phase 2 Personal Falcon, Phase 1, WoZ, PRD v2.8) with real commit citations. *Sources shown but NOT clickable — see gap below.* |
| V2 | Ask about something you **never** did | Honest "no grounded answer" — **not** a made-up answer | **Y** | *"billing software system"* → "I don't have anything in your synced work that answers this." Correct honest refusal. |
| V4 | Ask about a topic that has a decided direction | Only the *current* decision shows, not an old/superseded one | — | not explicitly tried |
| V5 | **Summarize a topic**, then **edit** the answer, save, reload | Your edited text is what shows after reload (your version wins) | **Y** | Asked → edited → "Save my version" → *"Saved — your version is now what Falcon uses."* Save UX works; DB persistence separately proven by the T022 automated test. (No in-panel history view to re-view it — see gap below.) |
| V6 | After a question, ask a **follow-up** without repeating context | It uses the previous answer as context | **Y** | *"which of those touched the callback flow"* → surfaced the CSRF/callback work (GitHub/Linear/Jira), grounded to commits |
| V7 | Just notice the **speed** across a few questions | Feels quick enough | **?** | not yet reported |
| V8 | (Optional) provider error → honest "temporarily unavailable" | never a guess | — | not tried (optional) |

## Observed gap (found during the live pass)

- **Citations aren't clickable.** The panel renders each citation as a text label (`commit 176b9ff0f5`),
  not a link to the PR/commit. The core already carries `externalRef` + `type` + `title`; the fix is
  UI-only (wrap the chip in an `<a href>` to the GitHub URL). Strong "fix first" candidate — turns a
  label into real, openable provenance (the whole point of grounding).

## Overall verdict (the real question)

- **Would you actually come back and ask Falcon things during your week?** → **YES, regularly** (Guru, live pass 2026-08-30, on real synced GitHub work).
- **What worked:** grounded answers with real commit citations; correct honest refusal on unsynced topics ("billing"); follow-up used prior context; summary + edit-save worked.
- **One thing to fix first:** clickable citations (openable provenance), then a history view.

> **SC-005 solo-retention read = STRONG YES.** This is the second half of the D1 trigger (the first
> was the WoZ result). Both halves now point the same way → the signal to build toward the
> Coordinator (Phase 3) is met. Phase 3 remains gated on Guru's explicit go per CLAUDE.md.
