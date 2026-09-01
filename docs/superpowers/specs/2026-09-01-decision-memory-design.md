# Decision Memory — Design

**Date:** 2026-09-01
**Feature slug (Spec Kit):** `005-decision-memory`
**Sprint:** Sprint 1 of `reviews/near-term-plan-2026-09.md`
**Status:** design pending owner review (revised 2026-09-01 after code-checking review feedback); on
approval → `/speckit-specify`

---

## 1. Why this exists (PRD vision — do not drift)

Decision memory is **the moat**. The PRD is explicit:

- *"Compounding org decision memory"* is Falcon's durable differentiator vs. summary tools
  (PRD §16 comparison; §6 "it is the moat").
- The Org Decision Index (F2.4) and Decision Records (F10.1) are the artifacts that make it real;
  `decision_records` is the *"compounding asset the moat depends on"* with effectively-indefinite
  retention (PRD §12 retention policy).
- Goal **G6**: *"Produce a Decision Record, not just a summary."* The PRD's G6 metric — ≥ 1.0
  Decision Records per decision-bearing *meeting* — is **uncomputable in this sprint**, because
  meetings are not an indexed source yet (§4). This sprint uses a **local proxy** (decision records
  confirmed per active engineer-week; §11) and the PRD metric unblocks when meeting ingestion lands.

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

**Exit signal (falsifiable — set the bar before the pilot runs, while there's no stake in the
outcome):** **≥ 3 of 5 pilot engineers ask Falcon ≥ 2 decision questions in pilot week 2** (i.e.
return after week 1, not just a first-touch). *Decision question* has a no-classifier operational
definition — an answer that cited a decision record or carried a `decisionStatus` (§11 open Q3).
Supporting proxy: **≥ 1 decision record confirmed per active engineer per week** during the pilot.
See §11 for instrumentation and the G6 note.

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
evidence.** When a decision candidate is relevant to *any* question, it resolves to one of these
states (and a `confirmed` answer may *additionally* carry a pending change — see below). Each state
has a hard boundary on what may cross into the answer:

| State | What Falcon conveys | What may cross the boundary into the answer |
|---|---|---|
| **none** | (nothing about a decision) — normal grounded-or-silent behavior | — |
| **proposed_unconfirmed** | "This isn't settled yet — there's an unconfirmed candidate from PR #17. [Open the queue]" | **Existence + source pointer + queue link ONLY.** Never `decision`/`rationale`/`options` text. |
| **confirmed (settled)** | Grounded, cited answer built from the record | Full record content — it is ratified evidence |
| **superseded** | The current confirmed record, noted as superseding an earlier one | Current record content; the superseded record stays out of retrieval |

**These states are NOT mutually exclusive.** The most decision-memory-ish situation is *"we decided
Deepgram (confirmed), but there's an unratified proposal to switch (unconfirmed)."* If the resolver
picked only one state, it would answer *"we chose Deepgram"* flat — confidently stale, which is worse
than silence. So `settled` and a **pending change co-occur**: a `settled` answer may carry an optional
`pendingChange` field (metadata only — existence + `sourceRef` + queue link, same boundary rules as
`proposed_unconfirmed`). One extra field, not a new branch.

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
   the query + the grounding result, produce an optional `decisionStatus` object on `Answer`. The
   confirmed and unconfirmed checks are **independent** (per §5, they co-occur):
   - `settled` when a confirmed decision grounded a surviving claim (record id; note `changed` if it
     `supersedes` a prior record);
   - `pendingChange` / `proposed_unconfirmed` when an unconfirmed candidate matches within the
     **relevance ceiling** (a single absolute max-distance cutoff — see §11), carrying
     `{ sourceRefs, queueLink, count }` only. Attached as `pendingChange` alongside a `settled`
     answer, or as the standalone `proposed_unconfirmed` state when nothing confirmed grounded;
   - neither → omit.
   The LLM prompt is unchanged and never receives unconfirmed content, so it **cannot** quote or
   ground on it. The status line is assembled from metadata, not generated. This is source-driven
   (fires whenever a relevant unconfirmed candidate surfaces), **not** question-type routing.
   *Implementation:* the resolver detects a grounded decision via `citation.type === 'decision'` on a
   surviving claim (that's how `answerQuestion` already tags decision candidates) — no new plumbing.

5. **Embed the query once (Voyage rate limit).** Today `retrieve()` and `searchDecisions()` each embed
   the query independently; adding `matchUnconfirmedCandidates()` would make **3 Voyage embed calls for
   the same query string per question**. At Voyage's low RPM (see run gotchas) that throttles the
   pilot. Compute the query vector once in `answerQuestion` and thread it through all three (add an
   optional precomputed-vector param to `retrieve` / `searchDecisions` / `matchUnconfirmedCandidates`).

### 6.2 Write path — lifecycle (`packages/core`, new API routes)

- **Create** (`createDecision`) → inserts `status: 'unconfirmed'`, embeds immediately.
  `POST /api/decisions`.
- **Confirm** (`confirmDecision`) → sets `status: 'confirmed'`, stamps `confirmedBy` + `confirmedAt`.
  This is the human-in-the-loop write gate that feeds the read path (F10.1 / R23).
- **Supersede** (`supersedeDecision`) → new confirmed record links to the old via `supersedesId`; old
  flips to `superseded` and drops out of retrieval (reversed decisions never surface as live — R23).
- **Dismiss** → an unconfirmed candidate the user rejects. `PATCH /api/decisions/[id]` covers confirm
  / supersede / dismiss.

  **Requires a DB migration — via an `ADD COLUMN`, not a status enum change.** `decision_record` is
  **hash-partitioned (16 partitions)** and its `status` CHECK constraint is enforced in the raw DDL
  (`0001_init.sql:110`, invisible from the Drizzle `text('status')` column). Rather than do
  constraint-surgery on the partitioned parent to add a 4th `status` value, dismiss is modeled as a
  **nullable `dismissed_at timestamptz` column** (`ALTER TABLE … ADD COLUMN` cascades cleanly to
  partitions, gives an audit timestamp, and keeps "dismissed" *orthogonal* to the
  unconfirmed/confirmed/superseded lifecycle instead of overloading it). This is the sprint's one
  schema change.

  Dismiss is a **persistent tombstone**, not a hard delete — the Ship-2 auto-miner re-scans merged
  PRs and **would re-suggest a dismissed `sourceRef`** on the next sync. So: `matchUnconfirmedCandidates`
  filters `status = 'unconfirmed' AND dismissed_at IS NULL`, and the miner skips any `sourceRef` that
  already has a record (dismissed, confirmed, or superseded). Grounding is already safe —
  `searchDecisions` filters `status = 'confirmed'`.

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

- **Unit (pure):** status resolver returns `settled` / `proposed_unconfirmed` / omitted correctly,
  **and returns `settled` + `pendingChange` together** when a confirmed record and a relevant
  unconfirmed candidate both exist (the flagship §5 case); `matchUnconfirmedCandidates` never returns
  content fields and excludes `dismissed`; supersede excludes the old record.
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

---

## 11. Open questions & instrumentation

**Open questions (resolve during `/speckit-plan`, not left implicit):**

1. **The relevance ceiling (§6.1.4) — one cutoff, two reasons it's needed.** What absolute cosine
   **max-distance** makes an unconfirmed candidate "relevant enough" to surface? (Distance metric:
   smaller = closer; the ceiling is the largest distance we'll still surface. Equivalently a minimum
   similarity.) There is no such cutoff anywhere in retrieval today — `retrieve` / `searchDecisions`
   just `orderBy(dist).limit(k)`, so they always return their k nearest even when nothing is actually
   relevant. Two failure modes this cutoff prevents:
   - *Noise:* too loose → answers grow a spurious "there's an unconfirmed candidate" footer until
     people learn to ignore it (the feature dies of noise).
   - *Small corpus:* at N≈10 records, top-k is near-arbitrary and will confidently surface an
     unrelated decision — the first thing a tester hits. This is a latent property of the
     **already-shipped** `searchDecisions` too.
   Proposed method: calibrate the ceiling on the pilot corpus rather than guessing a constant; start
   conservative (surface only very close matches) and loosen on evidence. Decide whether to backfill
   the same ceiling into `searchDecisions`. **Make-or-break.**
2. **Dismiss ↔ miner interaction (§6.2) — resolved to `dismissed_at` + `sourceRef` suppression.**
   Left here only to confirm during `/speckit-plan` that no case needs a separate suppression table
   (e.g. suppressing a `sourceRef` that never produced a record). Default: no.
3. **"Decision question" definition (metrics).** The retention signal counts "decision questions,"
   but we deliberately do **not** classify questions by type (§4). Operational definition to lock:
   a *decision question* = **a question whose answer cited ≥ 1 decision record OR carried a
   `decisionStatus`** — measurable without a classifier, consistent with the general-Q&A design.

**Instrumentation (day one — the product is downstream of whether people confirm):**

- **Confirmations/week** and **median unconfirmed-queue age** (is the confirm ritual actually
  happening, or is the queue rotting?).
- **Decision questions asked / engineer / week** — answers that cited a decision record or carried a
  `decisionStatus` (the retention exit signal, §3; definition in open Q3).
- **Status-resolver fire rate** — how often answers carry a `proposed_unconfirmed` / `pendingChange`
  footer (early-warning for a too-loose threshold, open question 1).
- **Records confirmed / active engineer-week** — the sprint-local proxy for G6 (§1).

All via the existing `packages/observability` (Langfuse) surface; no new dependency.
