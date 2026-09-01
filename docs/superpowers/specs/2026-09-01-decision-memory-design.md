# Decision Memory — Design

**Date:** 2026-09-01
**Feature slug (Spec Kit):** `005-decision-memory`
**Sprint:** Sprint 1 of `reviews/near-term-plan-2026-09.md`
**Status:** design approved by Guru (2026-09-01); next step = `/speckit-specify`

---

## 1. Why this exists (PRD vision — do not drift)

Decision memory is **the moat**. The PRD is explicit:

- *"Compounding org decision memory"* is Falcon's durable differentiator vs. summary tools
  (PRD §16 comparison; §6 "it is the moat").
- The Org Decision Index (F2.4) and Decision Records (F10.1) are the artifacts that make it real;
  `decision_records` is the *"compounding asset the moat depends on"* with effectively-indefinite
  retention (PRD §12 retention policy).
- Goal **G6**: *"Produce a Decision Record, not just a summary."* Success metric: ≥ 1.0 Decision
  Records per decision-bearing meeting (PRD §11).

Real tester feedback (2026-08-31) independently pointed at this same layer: *"ask why did we decide
X"* was the #1 requested feature. This sprint delivers the near-term slice of that vision **on the
already-shipped Phase 1/2 foundation**, without waiting for live mediation (Phase 3→4), which
remains on the roadmap.

**Framing correction (owner, 2026-09-01):** Decision Records are **a structured knowledge source**,
not a question-specific feature. Falcon's Q&A is **general-purpose — "ask anything about your team's
work"** — and the retrieval core draws on whatever sources are relevant. This design does **not** add
a decision-question menu or question-type routing. It makes Decision Records a well-formed, safe
source feeding the existing general answer core.

---

## 2. What already exists (ground truth from the code)

The **read path is shipped**; only the **write path and the source-boundary handling** are missing.

| Component | File | Status |
|---|---|---|
| `decision_record` table — full F10.1 shape (`status`, `supersedesId`, `confirmedBy/At`, `options`, `rationale`, `dissent`, `ownerUserId`, `sourceRef`, `revisitAt`, `embedding`) | `packages/db/src/schema.ts` | ✅ exists |
| `searchDecisions()` — semantic search, **confirmed-only** (FR-012 / R23), freshness-flagged | `packages/core/src/decisions.ts` | ✅ shipped |
| General grounded Q&A — `answerQuestion()` retrieves across artifacts + confirmed decisions through one provenance gate (Constitution II) | `packages/core/src/answer.ts` | ✅ shipped |
| `/decisions` page + `/api/decisions` GET — read-only search | `apps/web/app/(dashboard)/decisions/…` | ✅ shipped |
| Personal Falcon Q&A panel | `apps/web/app/(dashboard)/falcon/…` | ✅ shipped |

**Gap:** nothing *creates* a decision, nothing *confirms* one (the step that makes it retrievable),
and the retriever cannot yet distinguish "no decision" from "an unconfirmed candidate exists."

---

## 3. Goal of this sprint

> Populate the Decision Records source (write path) and teach the retriever the
> **confirmed / unconfirmed boundary**, so a source that is currently empty and read-only becomes a
> real, safe input to Falcon's general Q&A — then ship to the warm engineers and measure whether they
> return to ask.

**Exit signal:** engineers *return* to ask Falcon "why/what" questions (retention) — per the
near-term plan.

---

## 4. Sources available to the general Q&A (honest inventory)

The answer core is already source-agnostic. Ingested **today**: GitHub PRs/commits/reviews,
Linear/Jira issues, the personal work digest, and **confirmed Decision Records**. Therefore:

- "Why did we choose Deepgram?" → Decision Records ✅ (once records exist)
- "What changed in the API?" / "What happened with the payment bug?" → GitHub + issues ✅
- "What are we shipping this week?" → Linear/Jira ✅
- "What did Sarah say in the launch meeting?" → **Meetings are not an indexed source yet** (live
  transcript deprioritized per current strategy). The architecture extends to it cleanly when meeting
  ingestion is built; this design does **not** claim it works today.

No question-specific code. New sources plug into the same retriever later.

---

## 5. The four-state source boundary (the load-bearing rule)

Owner's rule (2026-09-01): **unconfirmed decisions must be visible as status metadata, but never as
evidence.** When a decision candidate is relevant to *any* question, it resolves to exactly one
state, and each state has a hard boundary on what may cross into the answer:

| State | What Falcon conveys | What may cross the boundary into the answer |
|---|---|---|
| **none** | (nothing about a decision) — normal grounded-or-silent behavior | — |
| **proposed_unconfirmed** | "This isn't settled yet — there's an unconfirmed candidate from PR #17. [Open the queue]" | **Existence + source pointer + queue link ONLY.** Never `decision`/`rationale`/`options` text. |
| **confirmed (settled)** | Grounded, cited answer built from the record | Full record content — it is ratified evidence |
| **superseded** | The current confirmed record, noted as superseding an earlier one | Current record content; the superseded record stays out of retrieval |

### 5.1 The invariant this forces

> **Unconfirmed decision content never reaches the model and never becomes a citation.**

Enforced by two mechanical properties (below), not by prompt instructions.

---

## 6. Architecture

### 6.1 Data / retrieval (`packages/core`, `packages/db`)

1. **Embed on *create*, not on confirm.** Manual entries and miner candidates get an embedding
   immediately, so the source is searchable in both states. The retrievability guard is purely
   `status = 'confirmed'` (already true in `searchDecisions`); embedding presence is only a search
   prerequisite, **not** the gate. This is the change that lets an unconfirmed candidate be *matched*
   to a question without becoming evidence.

2. **`searchDecisions()` — unchanged.** Confirmed-only grounding candidates for `answerQuestion`.

3. **New `matchUnconfirmedCandidates(deps, workspaceId, query, k)`** — returns **metadata only**:
   `{ id, sourceRef, createdAt }[]` (+ score). It deliberately does **not** return `decision`,
   `rationale`, or `options`, so unconfirmed content cannot leak into an answer.

4. **New deterministic status resolver** (pure, unit-tested), run in code **outside the LLM**: given
   the query + the grounding result, produce an optional `decisionStatus` object on `Answer`:
   - if a confirmed decision grounded a surviving claim → `settled` (record id; note `changed` if it
     `supersedes` a prior record);
   - else if a strongly-matching unconfirmed candidate exists (distance under a threshold) →
     `proposed_unconfirmed` with `{ sourceRefs, queueLink, count }` only;
   - else → omit.
   The LLM prompt is unchanged and never receives unconfirmed content, so it **cannot** quote or
   ground on it. The status line is assembled from metadata, not generated. This is source-driven
   (fires whenever a relevant unconfirmed candidate surfaces), **not** question-type routing.

### 6.2 Write path — lifecycle (`packages/core`, new API routes)

- **Create** (`createDecision`) → inserts `status: 'unconfirmed'`, embeds immediately.
  `POST /api/decisions`.
- **Confirm** (`confirmDecision`) → sets `status: 'confirmed'`, stamps `confirmedBy` + `confirmedAt`.
  This is the human-in-the-loop write gate that feeds the read path (F10.1 / R23).
- **Supersede** (`supersedeDecision`) → new confirmed record links to the old via `supersedesId`; old
  flips to `superseded` and drops out of retrieval (reversed decisions never surface as live — R23).
- **Dismiss** → an unconfirmed candidate the user rejects (soft-delete / status).
  `PATCH /api/decisions/[id]` covers confirm / supersede / dismiss.

All writes go through `withTenant` (Postgres RLS — PRD §12.9, blocker-class). Only confirmed records
are ever retrievable (F10.1).

### 6.3 Auto-suggest miner — **second ship**

Background job on the existing sync path runs a **conservative** LLM over newly merged PRs / closed
Linear issues; on a clear decision signal ("chose X over Y", "adopted", "deprecated", "resolved as")
it inserts an `unconfirmed` candidate with pre-filled `title` / `decision` / `rationale` / `sourceRef`
and an embedding. Bias toward **fewer, clearer** candidates — a flooded queue kills the confirm
ritual. Everything lands in the **same** unconfirmed queue as manual capture (one confirm ritual).
Falcon only *suggests*; a human confirms — the human-in-the-loop invariant holds.

### 6.4 Web UI (`apps/web`)

- **`/decisions`** extended: keep search; add **"Log a decision"** form and an **Unconfirmed queue**
  section (confirm / edit / supersede / dismiss).
- **Decision detail view** — `decision`, `rationale`, `dissent`, `owner`, `options`, `sourceRef`,
  supersede chain, status, confirmedBy/At, freshness flag.
- **Clickable citations** — when the general Q&A cites a decision, the citation links to the detail
  view (today a cited decision has a null URL / label only). Closes the loop testers asked for.

Product framing/UI copy: **"Decision Memory."** Code/data keep the PRD term **Org Decision Index**
(CLAUDE.md: do not contradict the PRD). No PRD change.

---

## 7. Non-negotiable invariants honored

- **Grounded or silent** (Constitution II / PRD F7.2, R4, R20): answers gate on retrieval; no
  confirmed evidence → no claim. Unchanged.
- **Only confirmed is evidence** (F10.1 / R23): enforced by the `status='confirmed'` grounding filter
  + embed-on-create not changing the gate.
- **Unconfirmed never reaches the model** (§5.1): `matchUnconfirmedCandidates` returns metadata only;
  status resolver runs outside the LLM.
- **Reversed decisions never surface as live** (R23): supersede flips old record out of retrieval.
- **Human-in-the-loop write gate** (F10.1 / F10.4): confirm is a human action; the miner only
  suggests. Falcon never writes to the retrievable index on its own.
- **Tenant isolation at the DB** (PRD §12.9, R25): every read/write via `withTenant` RLS.
- **Pin model versions** (PRD §12.8): miner + any embed calls use pinned model IDs, never `-latest`.

---

## 8. Testing strategy

- **Unit (pure):** status resolver returns `settled` / `proposed_unconfirmed` / omitted correctly;
  `matchUnconfirmedCandidates` never returns content fields; supersede excludes the old record.
- **Integration (real Postgres, RLS on):** capture → confirm → search → general Q&A returns a
  grounded, cited answer; unconfirmed candidate yields a status line but **never** a claim/citation;
  superseded record is excluded from grounding; cross-tenant read returns nothing (SC-003 style).
- **Miner:** a decision-bearing PR yields exactly one candidate; a routine PR yields none.

---

## 9. Scope / sequencing (weekly ships)

- **Ship 1:** write path (create/confirm/supersede/dismiss) + embed-on-create + status resolver +
  detail view + clickable citations. This alone makes the source real and safe end-to-end.
- **Ship 2:** auto-suggest miner into the same queue.

**Out of scope (roadmap, not now):** meeting ingestion as a retrieval source; live mediation cards
(Phase 3 US2/US3 → Phase 4); Decision Index pruning/tiering at 3-year scale (PRD §18 open question);
tester feature #7 "AI auto-creates tasks" (conflicts with human-in-the-loop; held per near-term plan).

---

## 10. PRD traceability

F2.4 (Org Decision Index) · F10.1 (decision lifecycle unconfirmed→confirmed→superseded) · F10.4
(one-click confirm) · F7.2 / R4 / R20 (provenance-gated output) · R23 (self-poisoning memory guard) ·
G6 / §11 (Decision Record per decision meeting) · §12.9 / R25 (RLS tenant isolation) · §12.8 (pinned
model versions) · §6 / §16 (compounding org decision memory = the moat).
