# DRAFT — proposed PRD amendment for D1 (owner approval required)

**Status:** DRAFT proposal. I do NOT edit `PRD.md` or `design.md`. This lays out the *minimal,
honest* change so Phase 2 (Personal Falcon, `specs/002-personal-falcon`) does not diverge from the
PRD (Constitution I). Owner (Guru) approves, then applies.

## The nuance that shapes this

Per the PRD v2.7 changelog, **D1 (solo-first repositioning) is evidence-gated on TWO signals:**
"the Phase 1–2 Wizard-of-Oz result **plus** a Phase 2 solo-retention read." Only the **WoZ half is
now in** (`reviews/woz-results.md`). The solo-retention read requires Phase 2 to be built and used.

**Therefore: do NOT fully apply D1 yet.** Fully repositioning (the `landing.html` headline, the
`design.md` identity) before the solo-retention read would jump the PRD's own gate and break the
"reversible bet." What Phase 2 actually needs is a **narrower, additive** amendment: sanction the
personal grounded Q&A / self-context capability within the existing "Phase 2 — Solo Client," and
record the WoZ evidence. The full identity reposition stays held until the solo-retention read.

## Proposed edits (ADDITIONS only — no existing copy rewritten)

### 1. New changelog entry (add after the v2.7 entry)

> **v2.8 changelog (Phase-1→2 evidence pass).** The Phase 1–2 Wizard-of-Oz test ran
> (`reviews/woz-results.md`): grounded context recall is valued (H1 holds; ~4/5 didn't-know,
> ~80% would-change across instrumented teams), the symmetric/face-saving card shape is decisively
> preferred (H2; F9.2a confirmed), and live push-cards hit a latency wall (~60s, H3) — the one
> load-bearing risk. Users independently and repeatedly asked for a **private, personal pull/Q&A
> self-context mode** ("what did I do for X; does it match the architecture?") and, asked directly,
> chose **per-person private agents + one Main Coordinator** (the PRD architecture) over a single
> shared Falcon. This satisfies the **WoZ half** of the D1 trigger. Applied here: Phase 2 (Solo
> Client) is scoped to deliver the personal grounded Q&A / self-context capability as its core (see
> `specs/002-personal-falcon`), with **solo retention (SC-005) as the second D1 signal**. Deliberately
> NOT yet applied: the full solo-first repositioning of `landing.html` / `design.md` identity — that
> remains held until the Phase-2 solo-retention read completes the trigger. The bet stays reversible.

### 2. §17 Phase 2 — Solo Client (add a scope note; do not rewrite the existing lines)

> **Phase 2 core capability (added v2.8, evidence: WoZ):** a private, per-user grounded **Q&A /
> self-context** agent over the user's own and ACL-visible team work — pull, not push (no latency
> wall), built on the Phase 1 context layer. Every claim is provenance-gated (Gate 3 for answers:
> no citation → claim dropped). Spec: `specs/002-personal-falcon`. Success gate: **solo retention**
> (do users return to ask?) — this is the second half of the D1 evidence trigger. Out of scope for
> Phase 2 (unchanged): audio, pairing, the Main Coordinator, live mediation cards.

### 3. Open Q8 / D1 status line (append to the existing held note)

> **Update (v2.8):** the WoZ half of the D1 trigger is satisfied; the solo-first *lead positioning*
> call remains held pending the Phase-2 solo-retention read. Phase 2 build scope is settled
> (personal Q&A) without pre-committing the marketing/identity reposition.

## Explicitly NOT changed by this amendment

- `landing.html` headline and `design.md` "Quiet Voltage" identity/copy — untouched (copy-do-not-
  rewrite; held for the full D1 pass after the solo-retention read).
- The roadmap end-state — personal agents + Main Coordinator + grounded mediation — unchanged. This
  is build-order + a newly-sanctioned pull/Q&A capability, not a vision change.

## AD check (Constitution G3)

None of AD-1…AD-8 govern the personal Q&A / retrieval-answer path directly (they concern clock
sync, orchestration substrate, latency SLOs, webhook order, client versioning — all pairing/
mediation/desktop concerns). **No AD spike blocks Phase 2.** Re-confirm at plan review.

## What I need from you

Approve (or edit) these additions. On approval, applying them to `PRD.md` is a small, deliberate
edit pass — say the word and I'll make exactly these additions (and nothing else). `design.md` and
`landing.html` stay untouched until the solo-retention read.
