# In-Meeting Decision Listener — Automatic Decision Capture from Live Meetings

**Date:** 2026-09-02
**Status:** Design (brainstorm complete; pre-plan)
**Feature area:** Decision Memory (PRD F10.1) — a third capture producer alongside manual + the artifact miner
**Depends on:** Ship 1 (Decision Records write path + lifecycle), Ship 2 (the `extractDecisions` spotter, queue/budget/ledger/suppression machinery), Phase 3 US1 (pairing → attributed live transcript)
**Related:** [[project-tester-wants-automatic-in-meeting]], [[project-source-agnostic-capture-vision]], `specs/005-decision-memory/`

---

## 1. Problem & goal

Ship 1 gave us a trustworthy Decision Record notebook; Ship 2 gave us automatic capture from **synced
artifacts** (merged PRs, completed issues). The remaining — and originally-requested — capture surface is
the **live meeting**: two paired people talk, a decision happens in the conversation, and it should land
in the same unconfirmed queue for one-click ratification, *without anyone typing it up afterward*.

This ship adds the **fourth production stage** that turns a finished meeting into drafted, cited,
unconfirmed Decision Records. It reuses three things unchanged — the attributed live transcript
(Phase 3 US1), the `extractDecisions` spotter (Ship 2), and the unconfirmed queue + confirm/edit/dismiss
lifecycle (Ship 1) — and builds only the seams between them.

**North-star quality metric:** confirm-rate of meeting-suggested records. A post-call summary people stop
opening is worse than no summary at all.

## 2. The load-bearing reframe: capture *after* the meeting, not *during* it

A live spotter must commit to "a decision happened" **before the meeting has decided whether it sticks.**
Real meetings reverse themselves:

> "Let's just use SQLite." — "Yeah, okay." — *[four minutes later]* — "Wait, the concurrency thing kills
> it. Postgres."

A live spotter fires on the first exchange and is confidently wrong — in an interrupting card, in front
of the whole room. That is R23 self-poisoning surfacing at the UI layer, worse than the silent version
because it asserts something false to everyone in real time. **Post-meeting extraction sees the full
transcript and resolves intra-meeting reversals for free** — it captures the Postgres decision, not the
SQLite one.

So post-meeting capture is not the cautious choice; it is the **correct** one. Live in-meeting capture is
not merely "later" — it is *harder, and wrong until online reversal-detection is solved.* That harder
feature is named and deferred in §11 as **"in-room live correction,"** so it reads as a genuinely
different product, not the ambitious version we flinched from.

**Open item — check with the tester.** They said "stored for both," which is about **shared memory**, and
post-meeting capture satisfies it. But if what they actually wanted was the in-room *"no, that's not what
we said"* correction, that is the deferred feature under its own name. Verify the reading before assuming.

## 3. Decisions locked in the brainstorm

| # | Decision | Rationale |
|---|---|---|
| D1 | **Post-meeting extraction**, not live detection | Correctness: only the full transcript resolves intra-meeting reversals. Live detection is confidently wrong in front of the room. |
| D2 | Suggestions land in the **existing Ship-1 unconfirmed queue** | Reuse the confirm surface wholesale; no Phase-4 live-panel machinery. |
| D3 | An **end-of-meeting delivery moment** is mandatory | Peak intent is the 60s after a call. Without a post-call surface, capture is automatic but confirmation becomes the new bottleneck — the manual step moves, it doesn't vanish. |
| D4 | Citable unit = **extractor-selected spans**, not a fixed window | The *why* usually sits minutes from the *what*; a fixed ±window captures the conclusion and cuts off the rationale, which is the product. |
| D5 | **Excerpt lifetime = candidate lifetime** | Confirmed → excerpt persists as citation. Dismissed → excerpt deleted; tombstone keeps only the normalized title for suppression, never the speech. Otherwise "dismiss" secretly means "store this conversation forever, unjustified." |
| D6 | **B default + opt-in full-transcript retention** (default-off workspace setting, 7–14d TTL) | Keeps `extractorVersion` re-mining, an eval corpus, and miss-debugging alive on the modality where the extractor is weakest — spoken/disfluent/multi-speaker. Retention can't be retrofitted onto discarded data. |
| D7 | **Durable working copy** at session end (24–72h TTL), job payload is `{workspaceId, meetingId}` | Neither passing the transcript in the payload (Redis again; gone when retries exhaust) nor pulling from Redis at job time (races the event-log TTL, and the budget-defer-past-midnight path *guarantees* some jobs run tomorrow) is safe. A PR you failed to mine is still on GitHub; a meeting you failed to extract is gone. |
| D8 | Trigger = **explicit "End meeting" + idle-disconnect fallback**, with a rejoin grace window and a session-length cap | Grace window stops a flaky connection splitting one meeting into two half-extracted records; the cap stops a forgotten tab becoming a 4-hour "meeting." |
| D9 | **Index-referenced spans** — the model *points*, we own the timestamps | The model does the only thing it's reliable at (pointing at utterances); we do the thing that must be exact (fidelity). Quote-and-locate (B) and model-emitted timestamps (C) demand exactness the model can't deliver on disfluent speech. |
| D10 | **Two-tier visibility** — `rationale` summary is workspace-visible, verbatim spans are attendee-gated | The §9.3 resolution: raw speech never leaves the room it was said in, while the decision + why becomes team memory. Same rule PR-sourced records already follow (GitHub link governed by GitHub's ACL). |
| D11 | **Separate suggestion budget** for meetings | Meetings are low-volume, high-value, time-critical. Sharing the PR miner's budget lets a heavy sync day defer meeting extraction to tomorrow — destroying the post-call moment D3 rests on. |
| D12 | Decision-visibility = **current workspace membership** (dynamic); span-visibility = **snapshotted attendees** (static) | Partial adoption from day one: memory back-fills to new joiners automatically; raw speech stays with the room forever. |

## 4. Architecture — new seams on existing machinery

```
Live meeting (Phase 3 US1)
  paired clients → per-person mic → Deepgram STT → utterance_final events (Redis event log, ephemeral)
        │
        │  session ends: explicit "End meeting" (any participant) OR idle-disconnect + grace window
        ▼
[session-worker]  assembleTranscript()
  1. read finalized utterance_final events from the Redis event log
  2. write a DURABLE WORKING COPY (Postgres) with a short TTL (24–72h), keyed by meetingId
  3. snapshot the attendee set onto the meeting object
  4. enqueue MeetingExtractJob { workspaceId, meetingId }   (separate budget lane, §7)
        ▼
[worker]  handleMeetingExtract(workspaceId, meetingId)          [apps/worker/src/handlers.ts]
  1. load working-copy transcript (withTenant)
  2. ledger gate — skip iff mined row exists with matching extractorVersion; record transcriptRetainedUntil
  3. budget gate — meeting lane; if over budget, re-enqueue delayed (jittered, high priority)
  4. chunk transcript by utterance-count (stable global indices) → extractDecisions per chunk
       input: [u12] Guru: the concurrency thing kills it   (index-prefixed lines)
       output per candidate: { title, decision, rationale, decisionSpans:[idx], rationaleSpans:[idx…], score }
  5. validate indices:  out-of-range → error path;  no valid decision span → drop candidate
  6. dedup across chunks by decision-span-index overlap (primary), normalized title (fallback)
  7. targeted RATIONALE PASS over the full transcript per surviving candidate (recovers minutes-away why)
  8. resolve spans → persist { speaker, timestamp, text } (resolved text, not indices)
  9. for each candidate with score ≥ DECISION_MEETING_MIN_CONFIDENCE:
        suggest-time suppression (same sourceRef + normalized title, any status)
        createDecision(origin='meeting', sourceRef=meetingId, spans=…, participants=snapshot, ownerHint)
 10. retention on  → working copy becomes retained transcript (7–14d TTL)
     retention off → working copy deleted; resolved spans kept
 11. DELIVERY: notify all attendees; address the actionable notification to ONE designated reviewer
        ▼
[web]  /decisions queue, filtered to meetingId
  reviewer (an attendee) reads verbatim spans → approves/edits the rationale SUMMARY → Confirm
  → summary becomes human-authored, workspace-visible team memory; spans stay attendee-gated
```

## 5. The excerpt: spans, not windows (D4, D9)

The extractor returns, per candidate, the utterance **indices** it used — split into a `decisionSpans`
set and one or more `rationaleSpans` (non-contiguous; the why is usually minutes from the what). We map
indices → `{speaker, timestamp, text}` from the stored transcript and **persist the resolved text.** The
citation must stand on its own after the working copy is deleted (default within 72h for retention-off
workspaces), so **indices are extraction-time scaffolding only** — kept alongside solely as re-mine
metadata on retained meetings.

**Guards (D9):**
- Any out-of-range index → treat as a parse failure → **error path** (not silent-drop-and-keep-candidate).
- **No valid decision span → no candidate.** An uncitable meeting decision violates "confirming is
  reading, not trusting" — the whole reason the excerpt exists.

**Chunking + the rationale pass.** Long meetings exceed context, so we chunk by utterance-count with
globally-stable indices. But chunk boundaries **orphan rationale** — if the boundary lands between the why
(u12) and the decision (u31), the decision-chunk can't see the why, and utterance overlap can't fix a gap
measured in *minutes*. Fix: after a candidate clears the bar, run a **targeted rationale pass over the
full transcript for that one candidate.** Candidates are rare, so n is small; this is far cheaper than two
full passes and makes chunk size stop being a quality-critical knob.

**Dedup.** Overlap surfaces the same decision twice, titled differently each time ("Use Postgres" vs
"Switch from SQLite to Postgres"). Title-matching fails exactly there. **Primary dedup = shared
decision-span index** (deterministic, free); normalized title only as the non-overlap fallback.

**Owner is a low-confidence hint (D6-consistent).** The speaker of the decision utterance is usually the
*facilitator summarizing* ("okay, so we're going with Postgres"), not the owner. Set `ownerHint` from that
speaker, but the confirm UI must **not present it authoritatively**, or we get systematically-wrong owners
that look authoritative.

## 6. Storage, retention & the working copy (D5, D6, D7)

- **Working copy** — at session end, session-worker assembles the finalized transcript and writes it to
  durable storage (Postgres) with a **24–72h TTL, independent of the retention setting.** The job reads
  from here. This is what makes meeting jobs compatible with the retry + budget-deferral machinery we
  reuse — without it, "reuse the miner's infra" silently imports a mechanism (defer-past-midnight) that
  destroys the irreplaceable modality.
- **After extraction:** retention **on** → working copy becomes the retained transcript (7–14d TTL);
  retention **off** → working copy deleted, resolved spans kept.
- **Retention setting** — a workspace setting, **default off**, on for our workspace and any pilot team
  that consents in exchange for shaping the product. This is C's *mechanism* with B's *default*: customers
  get the clean data-minimization story; we get the corpus that lets the extractor improve on spoken
  input, re-mine past meetings after a prompt bump, and debug "Falcon missed the decision we made
  yesterday" (the most important bug report, invisible under pure discard).
- **Meeting object records `transcriptRetainedUntil`** (nullable) so a reviewer knows whether "go read
  more" is even an option, and so the re-mine ledger doesn't *lie about eligibility*: re-mine skips
  discarded transcripts with an explicit "transcript discarded" reason instead of appearing eligible —
  otherwise a version bump looks like it re-mined everything while only touching opt-in workspaces, and
  the calibration numbers wouldn't mean what they say.
- **Dismiss deletes the excerpt** (D5): confirmed → spans persist as citation; dismissed → spans deleted
  with the candidate, tombstone keeps only the normalized title for suppression.

## 7. Trigger, execution & delivery (D3, D8, D11)

- **Trigger (D8):** explicit **"End meeting"** by any participant wins and ends it for everyone (others'
  clients told why); **idle-disconnect** is the fallback, gated by a **rejoin grace window** (~2 min) so a
  dropped connection doesn't split one meeting into two half-extracted records. A **session-length cap**
  ends a call left silently open. Someone reconnecting within the window **rejoins the same session.**
- **Execution:** reuse **BullMQ + `@falcon/queue`** (the PR-miner job pattern). `handleMeetingExtract`
  reuses ledger, suppression, and Langfuse naming unchanged; ledger is keyed on `meetingId +
  extractorVersion` (same re-mine contract as PRs, pointed at retained transcripts).
- **Budget (D11):** meetings get their **own budget lane**, separate from the PR miner's. A heavy sync day
  must never defer meeting extraction to tomorrow — that would destroy the post-call moment (D3). At
  minimum, meeting jobs jump the queue and draw from a reserved allocation.
- **Delivery (D3):** on job completion, **notify all attendees, but address the ask to one.** A designated
  reviewer (organizer, or the owner attributed to the first decision) gets the **actionable** notification
  — *"Review 3 decisions from Standup · 10:00"* → the `/decisions` queue filtered to that meeting.
  Everyone else gets **informational** — *"Falcon captured 3 decisions · Priya is reviewing."* Notifying
  three people equally produces three people assuming someone else will do it; this ritual's collapse
  kills the feature.

## 8. Visibility, membership & partial adoption (D10, D12)

The §9.3 resolution and the partial-adoption model are the *same* mechanism: **never conflate the three
populations.**

1. **Workspace members** — Falcon accounts in this tenant. Grows as the org adopts. *Not* the company.
2. **Meeting attendees** — who was in a given room. A snapshot. May include non-members.
3. **Capture subjects** — whose mic was transcribed. **Only ever paired Falcon clients.**

**Two visibility rules on one record:**
- **Decision + `rationale` summary → workspace-scoped, evaluated at *read time* against *current*
  membership** (`withTenant`, exactly Ship 1). Not a frozen ACL snapshot. Audience = "whoever is a member
  *right now*," so it **grows with adoption** — employee #21 who joins in a year inherits the full
  confirmed-decision history on join, with no migration or re-share.
- **Verbatim spans → gated to the *snapshotted attendee set*, forever.** Frozen at meeting time. Employee
  #21 sees the decision and why, never the raw exchange — they weren't there. §9.3 holds literally: **raw
  speech never leaves the room it was said in.**

**Confirm step makes the trust chain hold (D10).** Because non-attendees ground on the *summary*, not the
verbatim, the confirming attendee must **see and be able to edit** the summary: read verbatim → approve or
correct → the summary becomes **human-authored** team memory, the same trust chain a hand-typed record
always used. Summary review is a **required** part of the meeting-decision confirm step. (The reviewer is
always an attendee, so "confirming is reading" holds.)

**Non-Falcon people.** Falcon transcribes only paired clients, so a non-user in the room contributes **no
captured speech, no notification**, and at most a **context-only attendee label** (no ACL power). Their
words enter only as a *member's paraphrase*, which lives in an attendee-gated span **and** is **scrubbed
from the workspace-visible summary by prompt instruction** — otherwise a summary saying "the client's CTO
said security would block it" republishes an outsider workspace-wide, just laundered.

**Two follow-ons (decided):**
- **Attendee lists are snapshotted at meeting time** — people leave teams; the room they were in doesn't
  change.
- **Last attendee leaves the workspace** → the decision + summary **survive** (org memory outlives
  individuals); the verbatim spans **go dark** (no current member is in the snapshot) — retained for audit
  under the TTL, purged on expiry, never resurrected. *The memory outlives the people; the raw speech does
  not outlive its speakers' presence.*

**Honest cost (name it in the plan):** attendee-gated spans introduce **per-record row-level visibility
*inside* a workspace**, which `withTenant` does not currently express. That is new machinery and a new bug
class in **both** directions (leaking and over-restricting) — a **day of work, not an hour** — and the
real price of two-tier visibility, larger than the summary field.

**Consistency framing:** this is not special-cased for meetings. PR-sourced records already work this way
— their evidence is a GitHub link governed by GitHub's ACL, so a teammate without repo access reads the
decision but not the source. "The decision is team memory; the evidence has its own access rules" is a
rule we already ship, now made explicit.

## 9. Consent (in-product, not just the privacy policy)

"My raw transcript is private" is a promise already made; this ship narrows it, so say so **in the
product**:
- Excerpts backing a **confirmed** decision become **durable and visible to that meeting's attendees.**
- With retention **off**, a **full transcript still exists durably for up to 72h** (the working copy)
  while Falcon processes the meeting, then is deleted — "kept briefly while Falcon processes the meeting,
  then deleted."
- With retention **on**, the full transcript is kept for the configured window (7–14d).
- External (non-Falcon) participants' words may appear in an attendee-gated span if a member paraphrases
  them; the workspace-visible summary is scrubbed of their names.

## 10. Reuse map — what's built vs new

| Piece | Status |
|---|---|
| Paired clients → attributed live transcript ("Sarah: …", "Guru: …") | ✅ Phase 3 US1 |
| `extractDecisions` spotter (scored array, caller owns threshold) | ✅ Ship 2 — extended to emit span indices |
| Unconfirmed queue + Confirm/Edit/Dismiss + lifecycle | ✅ Ship 1 |
| Ledger / budget / suppression / Langfuse naming | ✅ Ship 2 — new meeting budget lane |
| Meeting-end trigger (explicit + idle + grace + cap) | ❌ New |
| Durable working-copy transcript (Postgres, 24–72h TTL) | ❌ New |
| `MeetingExtractJob` + `handleMeetingExtract` | ❌ New (mirrors `handleMine`) |
| Span extraction (index-referenced) + validation + rationale pass + span-overlap dedup | ❌ New (extractor + caller) |
| Resolved-span persistence + `participants` snapshot on record | ❌ New (data model) |
| Two-tier visibility: workspace summary + attendee-gated spans (row-level ACL) | ❌ New (**the day-of-work cost**) |
| Retention setting (default-off) + `transcriptRetainedUntil` on ledger/meeting | ❌ New |
| End-of-meeting delivery (notify-all, address-one reviewer) | ❌ New |

## 11. Non-goals & explicitly deferred

- **"In-room live correction"** — a live in-meeting card that lets the room say *"no, that's not what we
  said"* in real time. This is a **genuinely different, harder** feature (it requires solving online
  reversal-detection) and belongs on the roadmap under its own name. It is **not** the "ambitious version"
  of this ship — it is a separate product.
- **Slack / Gmail / Docs producers** — future callers of the same extractor core
  ([[project-source-agnostic-capture-vision]]); out of scope here.
- **Phase-4 mediation cards / gates / live coordinator** — deferred; this ship touches no live-panel
  surface beyond the post-call notification.
- **Calendar-sourced attendee lists / external-participant identity** — context labels only for now.

## 12. Open items to resolve before / during planning

1. **Tester intent check** (§2) — confirm "stored for both" means shared memory (this ship), not in-room
   live correction (deferred). One conversation.
2. **Consent-line wording** (§9) — finalize the exact in-product copy for the working-copy + attendee-gated
   disclosures.
3. **Retention TTL** — pick the concrete value in 7–14d; **working-copy TTL** — pick in 24–72h.
4. **`DECISION_MEETING_MIN_CONFIDENCE`** — provisional; calibrate against a labeled meeting corpus (the
   retention setting exists precisely to grow this corpus) before enforcing, mirroring Ship 2's shadow
   discipline.
5. **Session-length cap + grace-window** concrete values.
6. **Designated-reviewer rule** — organizer vs first-decision-owner; pin the default.
