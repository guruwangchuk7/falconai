# In-Meeting Decision Listener — Automatic Decision Capture from Live Meetings

**Date:** 2026-09-02
**Status:** Design (brainstorm complete; pre-plan)
**Feature area:** Decision Memory (PRD F10.1) — a third capture producer alongside manual + the artifact miner
**Depends on:** Ship 1 (Decision Records write path + lifecycle), Ship 2 (the `extractDecisions` spotter, queue/budget/ledger/suppression machinery), Phase 3 US1 (pairing → attributed live transcript)
**Related:** [[project-tester-wants-automatic-in-meeting]], [[project-source-agnostic-capture-vision]], `specs/005-decision-memory/`

**Roadmap position (read first).** This extends the Guru-approved **005 memory-layer pivot** on top of
shipped **Phase 1 / Phase 2 / Phase 3-US1**. It is **not** a Phase-4 start: it touches no live Coordinator,
no intervention gates, and no mediation cards, all of which remain gated (PRD §17). Implementation waits on
Guru's explicit phase-gate go; this document is pre-plan. Where the design departs from the literal PRD
text, it says so out loud (§11-A) rather than diverging silently, per CLAUDE.md.

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
of the whole room. That is **R23 self-poisoning** surfacing at the UI layer, worse than the silent version
because it asserts something false to everyone in real time. **Post-meeting extraction sees the full
transcript and resolves intra-meeting reversals for free** — it captures the Postgres decision, not the
SQLite one. This is the cleanest possible service of R23 (F10.1's founding risk).

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
| D1 | **Post-meeting extraction**, not live detection | Correctness: only the full transcript resolves intra-meeting reversals. Live detection is confidently wrong in front of the room (R23). |
| D2 | Suggestions land in the **existing Ship-1 unconfirmed queue** | Reuse the confirm surface wholesale; no Phase-4 live-panel machinery. |
| D3 | An **end-of-meeting delivery moment** is mandatory (the F10.4 recap surface) | Peak intent is the 60s after a call. Without a post-call surface, capture is automatic but confirmation becomes the new bottleneck — the manual step moves, it doesn't vanish. |
| D4 | Citable unit = **extractor-selected spans**, not a fixed window | The *why* usually sits minutes from the *what*; a fixed ±window captures the conclusion and cuts off the rationale, which is the product. |
| D5 | **Excerpt lifetime = candidate lifetime** | Confirmed → excerpt persists as citation. Dismissed → excerpt deleted; tombstone keeps only the normalized title for suppression, never the speech. Otherwise "dismiss" secretly means "store this conversation forever, unjustified." |
| D6 | **B default + opt-in full-transcript retention** (default-off workspace setting, 7–14d TTL) — authorized by §12.3 *"retention per workspace policy"* | Keeps `extractorVersion` re-mining, an eval corpus, and miss-debugging alive on the modality where the extractor is weakest — spoken/disfluent/multi-speaker. Retention can't be retrofitted onto discarded data. |
| D7 | **Durable working copy** at session end (24–72h TTL), job payload is `{workspaceId, meetingId}` — this *is* the §12.9/R27 *"idempotent session-end job so decisions are never lost on a partial write"* | Neither passing the transcript in the payload (Redis again; gone when retries exhaust) nor pulling from Redis at job time (races the event-log TTL, and the budget-defer path *guarantees* some jobs run tomorrow) is safe. A PR you failed to mine is still on GitHub; a meeting you failed to extract is gone. |
| D8 | Trigger = **explicit "End meeting" + idle-disconnect fallback**, with a rejoin grace window and a session-length cap | Grace window stops a flaky connection splitting one meeting into two half-extracted records; the cap stops a forgotten tab becoming a 4-hour "meeting." |
| D9 | **Index-referenced spans** — the model *points*, we own the timestamps | The model does the only thing it's reliable at (pointing at utterances); we do the thing that must be exact (fidelity). Quote-and-locate and model-emitted timestamps demand exactness the model can't deliver on disfluent speech. |
| D10 | **Two-tier visibility** — `rationale` summary follows the record's visibility tier, verbatim spans are always attendee-gated | Raw speech never leaves the room it was said in (§12.3 + the F9 publish model), while the decision + why is shareable team memory. Same rule PR-sourced records already follow (GitHub link governed by GitHub's ACL). |
| D11 | Meetings draw from a **reserved, jump-the-queue allocation within the workspace budget pool** — not a second, separate budget | Meetings are low-volume, high-value, time-critical; a heavy sync day must never defer meeting extraction to tomorrow (kills D3). But §12.6 mandates *"one throttle, not two"* — so this is a reserved lane *inside* the pool, not a parallel governance subsystem. |
| D12 | Decision-visibility = **current workspace membership** (dynamic); span-visibility = **snapshotted attendees** (static) | Partial adoption from day one: workspace-visible memory back-fills to new joiners automatically; raw speech stays with the room forever. |
| **D13** | **Per-record visibility tier — an *explicit* selection at confirm (`workspace` pre-selected \| `attendees-only`), at summary-edit prominence; widening is one-way** | Closes the "no scoped decision" hole: without it, *every* confirmed decision is company-wide forever — the summary of a sensitive founders' 1:1 reaches employee #21, even though the words were attendee-gated. Protecting the speech while publishing the substance is the inverse of the protection we built, and the reaction isn't "adjust visibility," it's "turn Falcon off for the meetings that matter." It is an explicit choice, *not* a skippable field, because size doesn't predict sensitivity (a 1:1 is the most routine unit on a small team; the sensitive all-hands exists too). `attendees-only → workspace` is a permitted **one-way** transition — the tier governs a *human-authored summary*, so widening is an ordinary editorial act (unlike widening raw spans, which is why C was rejected); narrowing after people have read it is theater, so it's forbidden. Rides the **same** row-level ACL we build for spans. |
| **D14** | **Owner attribution is a low-confidence hint** | The speaker of the decision utterance is usually the *facilitator summarizing* ("okay, so Postgres"), not the owner. Set `ownerHint`, but the confirm UI must not present it authoritatively, or we ship systematically-wrong owners that *look* authoritative. |
| **D15** | **Cross-tier supersede is status-visible, never citable** — a non-attendee querying a `workspace` record superseded by an `attendees-only` one gets *"superseded by a decision you don't have access to,"* not the stale record and not "nothing on record" | Without this, D13 reintroduces R23: Postgres (`workspace`) superseded by a private SQLite (`attendees-only`) → a non-attendee gets either the excluded-stale Postgres or an empty result, breaking the four-state guarantee for exactly the people the tier was meant to protect. Reuses Ship 1's unconfirmed-candidate discipline (status-visible, content-gated) pointed at a new case — a projection-layer rule, not new storage. |

## 4. Architecture — new seams on existing machinery

```
Live meeting (Phase 3 US1)
  paired clients → per-person mic → Deepgram STT → utterance_final events (Redis event log, ephemeral)
        │
        │  session ends: explicit "End meeting" (any participant) OR idle-disconnect + grace window
        ▼
[session-worker]  assembleTranscript()   ── the §12.9/R27 idempotent session-end job
  1. read finalized utterance_final events from the Redis event log
  2. write a DURABLE WORKING COPY (Postgres) — TRANSCRIPT TEXT, never audio (R6) — short TTL (24–72h)
  3. snapshot the attendee set onto the meeting object
  4. enqueue MeetingExtractJob { workspaceId, meetingId }   (reserved allocation in the pool, §7)
        ▼
[worker]  handleMeetingExtract(workspaceId, meetingId)          [apps/worker/src/handlers.ts]
  1. load working-copy transcript (withTenant)
  2. ledger gate — skip iff a mined row exists with matching extractorVersion.
                   (No contentHash needed, unlike PRs: a finalized transcript is IMMUTABLE, so
                    meetingId + extractorVersion fully identifies the work. Deliberate omission.)
                   record transcriptRetainedUntil (nullable) on the ledger row.
  3. budget gate — reserved lane; if the pool is over budget, re-enqueue delayed (jittered, high priority)
  4. chunk transcript by utterance-count (stable global indices) → extractDecisions per chunk
       input: [u12] Guru: the concurrency thing kills it   (index-prefixed lines)
       output per candidate: { title, decision, rationale, decisionSpans:[idx], rationaleSpans:[idx…], score }
  5. validate indices:  out-of-range → error path;  no valid decision span → drop candidate
  6. dedup across chunks by decision-span-index overlap (primary), normalized title (fallback)
  7. targeted RATIONALE PASS over the full transcript, TOP-N surviving candidates (cost-capped, §13)
  8. resolve spans → persist { speaker, timestamp, text } (resolved text, not indices)
  9. candidates with score ≥ DECISION_MEETING_MIN_CONFIDENCE →
        suggest-time suppression (same sourceRef + normalized title, any status)
        createDecision(origin='meeting', sourceRef=meetingId, spans=…, participants=snapshot,
                       ownerHint, visibility='workspace' [pending confirm-time choice, D13])
        ZERO candidates → write a no_decision ledger row (mirrors Ship 2), still notify (step 11)
 10. retention on  → working copy becomes retained transcript (7–14d TTL)
     retention off → working copy deleted; resolved spans kept
 11. DELIVERY (F10.4 recap):
        ≥1 decision → actionable notification to ONE designated reviewer; informational to other attendees
        0 decisions → informational to all attendees ("Falcon captured no decisions from Standup")
        reviewer inaction ≥24–48h → notification escalates to actionable for ALL attendees
        ▼
[web]  /decisions queue, filtered to meetingId
  reviewer (an attendee) reads verbatim spans → approves/edits the rationale SUMMARY
    → picks visibility: workspace (default) | attendees-only (D13) → Confirm
  → summary becomes human-authored team memory at the chosen tier; spans stay attendee-gated
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
full transcript for that candidate** — capped to the **top-N by score** to bound cost (§13). Candidates
are rare, so N is small; this is far cheaper than two full passes and makes chunk size stop being a
quality-critical knob.

**Dedup.** Overlap surfaces the same decision twice, titled differently each time ("Use Postgres" vs
"Switch from SQLite to Postgres"). Title-matching fails exactly there. **Primary dedup = shared
decision-span index** (deterministic, free); normalized title only as the non-overlap fallback.

**Owner is a low-confidence hint (D14).** The speaker of the decision utterance is usually the
*facilitator summarizing*, not the owner. Set `ownerHint` from that speaker, but the confirm UI must
**not present it authoritatively**, or we get systematically-wrong owners that look authoritative.

## 6. Storage, retention & the working copy (D5, D6, D7)

- **Working copy** — at session end, session-worker assembles the finalized **transcript text** (never
  audio, R6) and writes it to durable storage (Postgres) with a **24–72h TTL, independent of the retention
  setting.** The job reads from here. This is the §12.9/R27 idempotent session-end job made concrete —
  without it, "reuse the miner's infra" silently imports a mechanism (budget-defer past the extraction
  window) that destroys the irreplaceable modality.
- **After extraction:** retention **on** → working copy becomes the retained transcript (7–14d TTL);
  retention **off** → working copy deleted, resolved spans kept.
- **Retention setting** — a workspace setting, **default off**, directly authorized by §12.3
  (*"transcripts encrypted at rest, retention per workspace policy"*). On for our workspace and any pilot
  team that consents in exchange for shaping the product. This is the retention *mechanism* with a
  minimizing *default*: customers get the clean data-minimization story; we get the corpus that lets the
  extractor improve on spoken input, re-mine past meetings after a prompt bump, and debug "Falcon missed
  the decision we made yesterday" (the most important bug report, invisible under pure discard).
- **`transcriptRetainedUntil`** (nullable) on the meeting object *and* the ledger row, so a reviewer knows
  whether "go read more" is even an option, and so the re-mine ledger doesn't *lie about eligibility*:
  re-mine skips discarded transcripts with an explicit reason instead of appearing eligible — otherwise a
  version bump looks like it re-mined everything while only touching opt-in workspaces, and the
  calibration numbers wouldn't mean what they say.
- **Dismiss deletes the excerpt** (D5): confirmed → spans persist as citation; dismissed → spans deleted
  with the candidate, tombstone keeps only the normalized title for suppression.
- **`no_decision` ledger** — a meeting that produced nothing writes a `no_decision` ledger row keyed on
  `meetingId + extractorVersion` (same shape as Ship 2), so a prompt bump can re-mine it later if retained.

## 7. Trigger, execution & delivery (D3, D8, D11)

- **Trigger (D8):** explicit **"End meeting"** by any participant wins and ends it for everyone (others'
  clients told why); **idle-disconnect** is the fallback, gated by a **rejoin grace window** (~2 min) so a
  dropped connection doesn't split one meeting into two half-extracted records. A **session-length cap**
  ends a call left silently open. Someone reconnecting within the window **rejoins the same session.**
- **Execution:** reuse **BullMQ + `@falcon/queue`** (the PR-miner job pattern). `handleMeetingExtract`
  reuses ledger, suppression, and Langfuse naming unchanged; ledger keyed on `meetingId + extractorVersion`
  (same re-mine contract as PRs, pointed at retained transcripts).
- **Budget (D11):** per §12.6's *"one throttle, not two,"* meetings do **not** get a separate budget — they
  get a **reserved, jump-the-queue allocation *within* the per-workspace pool**. A heavy sync day must
  never defer meeting extraction (kills D3), but we keep this inside the PRD's single-governance model
  rather than standing up a parallel one.
- **Delivery (D3, the F10.4 post-meeting recap):**
  - **≥1 decision** → **notify all attendees, address the ask to one.** A designated reviewer (organizer,
    or the owner attributed to the first decision — pin the default in planning) gets the **actionable**
    notification — *"Review 3 decisions from Standup · 10:00"* → the `/decisions` queue filtered to that
    meeting. Everyone else gets **informational** — *"Falcon captured 3 decisions · Priya is reviewing."*
  - **0 decisions** → **informational to all** — *"Falcon captured no decisions from Standup."* Silence is
    ambiguous with "Falcon wasn't running" / "Falcon is broken"; for a listening product that ambiguity is
    corrosive.
  - **Escalation** → if the reviewer doesn't act within **24–48h**, the notification becomes actionable for
    **all attendees.** Addressing one prevents the bystander effect; escalation prevents D3's bottleneck
    from simply relocating to one inbox.
  - **Metric** → instrument **median queue age for meeting-sourced records separately** — it's the signal
    that tells you whether the post-call moment is actually working.

## 8. Visibility, membership & partial adoption (D10, D12, D13)

The privacy resolution and the partial-adoption model are the *same* mechanism: **never conflate the three
populations.**

1. **Workspace members** — Falcon accounts in this tenant. Grows as the org adopts. *Not* the company.
2. **Meeting attendees** — who was in a given room. A snapshot. May include non-members.
3. **Capture subjects** — whose mic was transcribed. **Only ever paired Falcon clients.**

**The record carries a visibility tier set by an *explicit* selection at confirm (D13): `workspace`
pre-selected, or `attendees-only`.** Shown at the same prominence as the summary edit — a deliberate
choice, never a field you skip past. This closes the hole that there is otherwise *no way to record a
decision that isn't company-wide* — which bites the first time two people have a sensitive conversation
with Falcon on, not at scale.

**Widening is one-way (D13).** `attendees-only → workspace` is permitted; the reverse is not. The tier
governs the *human-authored summary*, so widening is an ordinary editorial act — unlike widening raw spans
(the reason C was rejected). Narrowing after non-attendees have already read a record is theater, so it is
forbidden.

**Two visibility rules, composed with the tier:**
- **Decision + `rationale` summary** →
  - tier `workspace`: **workspace-scoped, evaluated at *read time* against *current* membership**
    (`withTenant`, exactly Ship 1). Not a frozen ACL snapshot — audience = "whoever is a member *right
    now*," so it **grows with adoption**; employee #21 who joins in a year inherits the full workspace-tier
    history on join, no migration, no re-share.
  - tier `attendees-only`: gated to the **snapshotted attendee set**, like the spans. The decision stays
    private to the room even as memory; nothing about it reaches non-attendees.
- **Verbatim spans → always gated to the *snapshotted attendee set*, forever**, regardless of tier. Frozen
  at meeting time. For a `workspace`-tier record, employee #21 sees the decision and why, never the raw
  exchange — they weren't there. Raw speech never leaves the room it was said in (the §12.3 + F9 basis —
  raw audio unstored, transcripts retained per policy, and only *published output* crosses to everyone).

**Confirm step makes the trust chain hold (D10).** Because non-attendees ground on the *summary*, not the
verbatim, the confirming attendee must **see and be able to edit** the summary: read verbatim → approve or
correct → the summary becomes **human-authored** team memory, the same trust chain a hand-typed record
always used. Summary review + the visibility choice are a **required** part of the meeting-decision confirm
step. (The reviewer is always an attendee, so "confirming is reading" holds.)

**Non-Falcon people.** Falcon transcribes only paired clients, so a non-user in the room contributes **no
captured speech, no notification**, and at most a **context-only attendee label** (no ACL power). Their
words enter only as a *member's paraphrase*, which lives in an attendee-gated span **and** is **scrubbed
from the summary by prompt instruction** — otherwise a summary saying "the client's CTO said security
would block it" republishes an outsider workspace-wide, just laundered. (Directly executes §12.4: *"Falcon
must tell users to inform people in the room; the app doesn't announce itself to non-users."*)

**Cross-tier supersede — status-visible, never citable (D15).** The tier interacts with the supersede
chain, and naively it reintroduces R23: a `workspace` Postgres decision superseded by an `attendees-only`
SQLite decision leaves a non-attendee with either the excluded-stale Postgres or an empty "nothing on
record" — the four-state guarantee broken for exactly the people the tier protects. Resolution reuses
Ship 1's unconfirmed-candidate discipline (status-visible, content-gated): a non-attendee querying the
superseded `workspace` record gets *"This decision has been superseded by a decision you don't have access
to"* — the **fact** of the change, **none** of its content, and **never a stale answer**. It is a
projection-layer rule over existing storage, not a new table.

**Two follow-ons (decided):**
- **Attendee lists are snapshotted at meeting time** — people leave teams; the room they were in doesn't.
- **Last attendee leaves the workspace** → a `workspace`-tier decision + summary **survive** (org memory
  outlives individuals); the verbatim spans (and any `attendees-only` record) **go dark** — retained for
  audit under the TTL, purged on expiry, never resurrected. *The memory outlives the people; the raw speech
  does not outlive its speakers' presence.*

**Honest cost (carry into the plan):** attendee-gated spans + the visibility enum introduce **per-record
row-level visibility *inside* a workspace**, which `withTenant` does not currently express — the single
biggest new build here, a new bug class in **both** directions (leaking and over-restricting), a **day of
work, not an hour.** It is **defense-in-depth *on top of* the §12.9 RLS tenant floor**, never a replacement
— app-layer per-record filtering is never the isolation floor. It is tested before it is written (§12).

**Consistency framing:** this is not special-cased for meetings. PR-sourced records already work this way —
their evidence is a GitHub link governed by GitHub's ACL, so a teammate without repo access reads the
decision but not the source. "The decision is team memory; the evidence has its own access rules" is a rule
we already ship, now made explicit and given a per-record tier.

## 9. Consent (in-product, not just the privacy policy)

"My raw transcript is private" is a promise already made (§12.3/§12.4); this ship narrows it, so say so
**in the product**, gated by the §12.4 two-party-consent workspace toggle where that applies (the toggle is
the gate on whether the working copy is even created):
- Excerpts backing a **confirmed** decision become **durable and visible to that meeting's attendees.**
- With retention **off**, a **full transcript still exists durably for up to 72h** (the working copy) while
  Falcon processes the meeting, then is deleted — "kept briefly while Falcon processes the meeting, then
  deleted."
- With retention **on**, the full transcript is kept for the configured window (7–14d).
- External (non-Falcon) participants' words may appear in an attendee-gated span if a member paraphrases
  them; the workspace-visible summary is scrubbed of their names (§12.4).

## 10. Reuse map — what's built vs new

| Piece | Status |
|---|---|
| Paired clients → attributed live transcript ("Sarah: …", "Guru: …") | ✅ Phase 3 US1 |
| `extractDecisions` spotter (scored array, caller owns threshold) | ✅ Ship 2 — extended to emit span indices |
| Unconfirmed queue + Confirm/Edit/Dismiss + lifecycle | ✅ Ship 1 |
| Ledger / suppression / Langfuse naming / budget pool | ✅ Ship 2 — new reserved meeting lane in the pool |
| Meeting-end trigger (explicit + idle + grace + cap) | ❌ New |
| Durable working-copy transcript (Postgres, 24–72h TTL) — §12.9/R27 idempotent session-end job | ❌ New |
| `MeetingExtractJob` + `handleMeetingExtract` | ❌ New (mirrors `handleMine`) |
| Span extraction (index-referenced) + validation + rationale pass + span-overlap dedup | ❌ New (extractor + caller) |
| Resolved-span persistence + `participants` snapshot on record | ❌ New (data model) |
| **Per-record visibility tier (`workspace`/`attendees-only`) + attendee-gated spans (row-level ACL)** | ❌ New (**the day-of-work cost**) |
| Retention setting (default-off) + `transcriptRetainedUntil` on ledger/meeting | ❌ New |
| End-of-meeting delivery (notify-all / address-one / zero-decision / escalation) | ❌ New |

## 11. Non-goals, deferred, and PRD divergences

### 11-A. Divergences from the literal PRD (surfaced, per CLAUDE.md)
- **Record authorship.** F10.1 says *"every record the **Coordinator** generates starts [unconfirmed]."*
  The Coordinator is a Phase-4 live component; we author records from a **post-meeting job** instead. This
  is deliberate and *better* here — it is what enables the reversal-resolution in §2 — and is consistent
  with the 005 pivot that decoupled the Decision Index from live mediation. Not a silent divergence.
- **Budget governance.** §12.6 mandates one pooled throttle; D11 keeps meetings inside it as a reserved
  lane rather than a second budget (already reconciled above).
- **Confirmation surface.** F10.1 envisions ratification "in the post-meeting recap (F10.4)"; we reuse
  Ship 1's `/decisions` queue as that surface, filtered per meeting. Same intent, existing surface.

### 11-B. Explicitly deferred
- **"In-room live correction"** — a live in-meeting card that lets the room say *"no, that's not what we
  said"* in real time. A **genuinely different, harder** feature (requires online reversal-detection);
  belongs on the roadmap under its own name. Not the "ambitious version" of this ship.
- **Slack / Gmail / Docs producers** — future callers of the same extractor core
  ([[project-source-agnostic-capture-vision]]); out of scope here.
- **Phase-4 mediation cards / gates / live Coordinator** — gated; this ship touches no live-panel surface
  beyond the post-call notification.
- **Calendar-sourced attendee lists / external-participant identity** — context labels only for now.

## 12. Testing (the bug class is named, so it is tested before it is written)

Row-level ACL is "a new bug class in both directions," so these assertions land **before** the code:

**Visibility / ACL (the leak surface — highest priority):**
- A **non-attendee member cannot read spans by any path** — including the **answer / citation path**,
  where a leak would actually happen (an answer grounded on a `workspace`-tier record must expose the
  summary, never the verbatim span, to a non-attendee).
- An **`attendees-only` record** is invisible (decision *and* summary) to non-attendee members on every
  read path (queue, detail, answer, history).
- An attendee who **left the workspace** is excluded from span access.
- A **new joiner** sees `workspace`-tier decision + summary and history, and **not** spans.
- **Cross-tier supersede (D15):** a `workspace` record superseded by an `attendees-only` record **never
  grounds a stale answer** for a non-attendee **and never returns "nothing on record"** — it returns the
  status-only "superseded by a decision you don't have access to."
- **Widening is one-way (D13):** `attendees-only → workspace` succeeds; `workspace → attendees-only` is
  rejected.
- Tenant floor intact: none of the above weakens §12.9 RLS — cross-tenant reads still return nothing.

**Extraction correctness:**
- Span validation routes **out-of-range indices to the error path**, not a silent drop.
- **No valid decision span → no candidate.**
- Cross-chunk **dedup collapses on decision-span-index overlap** (differently-titled duplicates merge).
- The **targeted rationale pass recovers a rationale deliberately placed outside the decision's chunk.**

**Lifecycle / delivery:**
- **Dismiss deletes the spans**; the tombstone retains only the normalized title.
- **Zero-decision** meetings still notify, and write a `no_decision` ledger row.
- **Reviewer escalation** fires after the inaction window.
- Job is **idempotent** on `{workspaceId, meetingId}` (replay/retry never double-creates records).

Calibration (`DECISION_MEETING_MIN_CONFIDENCE`) follows Ship 2's shadow discipline over a labeled **meeting**
corpus (the retention setting exists precisely to grow it), against written-down accept criteria before
enforcing — not a hardcoded blind threshold.

## 13. Cost model (this is plausibly the dominant per-workspace cost)

Per Ship 2, extraction runs on the pinned Haiku digest tier. A 60-minute meeting is:
- **Chunked extraction:** ~1 `extractDecisions` call per chunk. Chunk count scales with utterance density
  — order **6–12 calls** for a dense hour.
- **Targeted rationale pass:** 1 call per **top-N surviving candidate** (N small; candidates are rare) —
  order **1–4 calls**.

So **~10–20 LLM calls per meeting-hour**, Haiku-tier. Multiplied by a team's weekly meeting load, this is
plausibly the **largest per-workspace LLM cost in the product** — larger than the PR miner, which fires
per-artifact not per-hour. Two levers this model exposes, to be tuned in planning:
- **Cap the rationale pass to top-N** (already in §5/§4) — the **preferred lever if cost comes in hot**,
  because N only thins rationale on the *low-confidence candidates you were least sure about anyway*.
- **Chunk size** trades call-count against orphaned-rationale risk. It is the **worse lever to pull**:
  chunk size trades directly against *extraction quality*, whereas N trades only against rationale depth on
  marginal candidates. Reach for smaller N before larger chunks.

A concrete per-meeting-hour dollar figure and the N default are a planning task; the design keeps both as
tunable knobs rather than baking them in. This feeds the §12.2 COGS envelope and the reserved budget lane
(D11).

## 14. Open items to resolve before / during planning

1. **Tester intent check** (§2) — confirm "stored for both" means shared memory (this ship), not in-room
   live correction (deferred). One conversation.
2. **Consent-line wording** (§9) — finalize in-product copy for the working-copy, retention, and
   attendee-gated disclosures; confirm interaction with the §12.4 two-party-consent toggle.
3. **Retention TTL** (7–14d) and **working-copy TTL** (24–72h) — pick concrete values.
4. **`DECISION_MEETING_MIN_CONFIDENCE`** — calibrate against a labeled meeting corpus before enforcing.
5. **Session-length cap + grace-window** concrete values.
6. **Designated-reviewer default** — organizer vs first-decision-owner.
7. **Cost figures** (§13) — per-meeting-hour estimate + the rationale-pass **N** default.
8. **Client vs. internal decisions in one Decision Memory** *(added 2026-09-03)* — one flat, workspace-
   visible list mixes client-confidential decisions with internal ones. Two distinct problems:
   *confidentiality* (who may read — the visibility tier) and *context bleed* (client decisions as noise
   in retrieval for those who can see them — NOT solved by visibility; needs grouping). Mitigation now:
   the required, explicit confirm-time visibility choice (D13, refined below) enforced at the write gate.
   Deferred: engagement "spaces"/grouping — shape unknown until real usage; confirm whether client work
   is even in the pilot. Full write-up: **PRD §21 item 12**.
9. **The multi-workspace user & cross-workspace meetings** *(added 2026-09-03)* — a `session` carries one
   `workspace_id` chosen at pairing; a multi-workspace user (own company + N clients) can have a meeting
   filed under the wrong org, and RLS does NOT guard it (the write is legitimately authorized, just
   mis-attributed). Needs a host rule (session belongs to the starter's workspace; others are guests
   captured into the host org, no cross-posting), an explicit workspace pick at session start (no
   "last used" default), a "Recording into: <workspace>" capture indicator, and the selection stored on
   the meeting. Open fork: may a guest whose workspace differs be captured at all? Full write-up:
   **PRD §21 item 13**.

*(A size-based visibility default was considered and rejected: size doesn't predict sensitivity, and
defaulting small meetings to `attendees-only` would silently poison the §8 back-fill promise — on a
two-person company every decision is a 1:1, so the entire early corpus would become invisible to
employee #3. Visibility is an explicit confirm-time choice. **D13 refinement (2026-09-03):** the choice
is the ACTION — two confirm buttons, `[Confirm for team]` / `[Confirm — attendees only]`, with NO
pre-selected default a reviewer can scroll past, and the write gate refuses a meeting confirm that
carries no explicit visibility (`visibility_required`). The earlier "`workspace` pre-selected" default
was the fragile pattern that silently files a client decision workspace-wide; an external-attendee
signal now only pre-emphasizes attendees-only + shows a banner, never a silent default — detection
misses the solo-on-a-client-call case, so it can only ever suggest. See PRD §21 item 12.)*
