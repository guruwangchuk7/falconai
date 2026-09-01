# Feature Specification: Decision Memory

**Feature Branch**: `005-decision-memory`

**Created**: 2026-09-01

**Status**: Draft

**Input**: Approved design doc — `docs/superpowers/specs/2026-09-01-decision-memory-design.md`
(brainstormed + peer-reviewed + engineering code-checked, approved by owner 2026-09-01).

**PRD traceability**: F2.4 (Org Decision Index), F10.1 / F10.4 (decision lifecycle + one-click
confirm), F7.2 / R4 / R20 (provenance-gated output), R23 (self-poisoning memory guard), G6 /
§11 (Decision Record per decision meeting), §12.9 / R25 (RLS tenant isolation), §12.8 (pinned
models), §6 / §16 (compounding org decision memory = the moat). Constitution II (Grounded or
Silent) and the "Human-in-the-loop on memory" product invariant are load-bearing here.

## Context (what already exists — do not rebuild)

The **read path is shipped**: confirmed-only decision search, the general grounded Q&A that already
treats confirmed decisions as citable candidates, and the read-only `/decisions` search page. This
feature adds the **write path** and a **confirmed/unconfirmed source boundary** so that Decision
Records become a real, safe knowledge source feeding Falcon's *existing* general-purpose Q&A. It does
**not** add a decision-question feature, a question-type menu, or question routing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capture and confirm a decision so the team can recall it (Priority: P1)

A team member records a decision the team made — what was decided, why, the options weighed, who owns
it, and a link to where it happened. It is saved as **unconfirmed** and is not yet answerable. A
person then ratifies it in one click; only then does it become retrievable and answerable by Falcon.

**Why this priority**: This is the MVP. Without a write + confirm path the source is empty and the
already-shipped search and Q&A have nothing to work with. It directly delivers the tester's #1 want
("ask why did we decide X") and honors the non-negotiable human-in-the-loop write gate (F10.1/F10.4).

**Independent Test**: Log a decision → confirm it → it appears in `/decisions` search and Falcon
answers "why did we decide X?" with a grounded, cited answer. Fully testable with no other story.

**Acceptance Scenarios**:

1. **Given** no decision on a topic, **When** a member logs one (title, decision, rationale, options,
   owner, source), **Then** it is stored as `unconfirmed` and does **not** appear in confirmed search
   or ground any answer.
2. **Given** an unconfirmed decision, **When** a person confirms it, **Then** it is marked
   `confirmed` with the confirmer and timestamp recorded, and becomes retrievable.
3. **Given** a confirmed decision, **When** a user asks about that topic, **Then** Falcon returns a
   grounded answer citing that decision, and the citation links to the decision's detail view.
4. **Given** a confirmed decision, **When** any user opens its detail view, **Then** they see
   decision, rationale, dissent, owner, options, source, status, confirmer/at, supersede chain, and a
   freshness flag when older than the workspace horizon.

---

### User Story 2 - Honest four-state answers: unconfirmed is visible, never authoritative (Priority: P1)

When a user asks about a topic, Falcon distinguishes four situations and never blurs them: nothing on
record; a decision has been **proposed but not confirmed**; a **confirmed** decision exists; or a
confirmed decision that **supersedes** an earlier one. A proposed-but-unconfirmed decision is surfaced
as **status metadata only** ("not settled yet — there's an unconfirmed candidate from PR #17, open the
queue") and its content is **never** quoted or used as evidence.

**Why this priority**: This is the safety invariant that makes the source trustworthy (Constitution
II; R23). Saying "nothing on record" when an unconfirmed candidate exists is misleading; quoting the
unconfirmed candidate is worse. Both failure modes are prevented here. Co-equal P1 with US1 because
the invariant must hold from the first confirmed record onward.

**Independent Test**: Seed one confirmed and one unconfirmed record; ask matching questions; assert
the confirmed answer is grounded+cited, the unconfirmed surfaces as a status line with no content and
no citation, and the "confirmed + pending reversal" case shows both.

**Acceptance Scenarios**:

1. **Given** only an unconfirmed candidate matches the question, **When** the user asks, **Then**
   Falcon states it isn't settled and points to the queue, exposing only existence + source pointer +
   link — never the decision/rationale/options text — and produces no citation to it.
2. **Given** no confirmed and no relevant unconfirmed record, **When** the user asks, **Then** Falcon
   says nothing is on record (grounded-or-silent), rather than guessing.
3. **Given** a confirmed decision **and** a relevant unconfirmed candidate proposing a change, **When**
   the user asks, **Then** Falcon answers from the confirmed record **and** notes a pending change as
   metadata only — it does not answer as if the topic were fully settled.
4. **Given** any answer, **When** it is produced, **Then** no unconfirmed decision content ever
   appears in the generated text or in any citation.

---

### User Story 3 - Supersede a reversed decision so stale decisions never read as live (Priority: P2)

When the team reverses or replaces a past decision, a new confirmed decision is linked to the old one;
the old one is marked superseded and stops surfacing as the current answer.

**Why this priority**: Prevents Falcon citing a reversed decision as live (R23). Needed for
correctness over time but only bites once decisions get revised, so it follows the capture/answer core.

**Independent Test**: Confirm decision A; supersede it with B; ask the topic; assert Falcon answers
with B, A is excluded from grounding, and the detail view shows the A→B chain.

**Acceptance Scenarios**:

1. **Given** a confirmed decision A, **When** it is superseded by a new confirmed decision B, **Then**
   A is marked `superseded` and linked to B, and retrieval returns B, not A.
2. **Given** a superseded decision A, **When** a user asks the topic, **Then** A never grounds the
   answer and is never presented as current.

---

### User Story 4 - Dismiss a candidate so it stops nagging and never grounds (Priority: P2)

A reviewer rejects an unconfirmed candidate that isn't a real/keepable decision. It is tombstoned: it
never grounds an answer, never shows as a status line, and is never re-suggested.

**Why this priority**: Keeps the confirm queue trustworthy and prevents the auto-miner (US5) from
re-proposing the same rejected item. Matters most once the miner exists, so P2.

**Independent Test**: Dismiss an unconfirmed candidate; assert it disappears from the queue and status
surfacing; re-run the source that produced it and assert it is not re-created.

**Acceptance Scenarios**:

1. **Given** an unconfirmed candidate, **When** a reviewer dismisses it, **Then** it is tombstoned and
   no longer appears in the queue or as answer status metadata.
2. **Given** a dismissed candidate originating from a source item, **When** that source is re-scanned,
   **Then** no duplicate candidate is created for it.

---

### User Story 5 - Auto-suggest decisions from merged work (Priority: P3) — *Ship 2*

As merged pull requests and closed issues arrive, Falcon conservatively proposes likely decisions into
the same unconfirmed queue, with fields pre-filled and the source linked, so a person can confirm in
one click. Falcon only suggests — it never writes a retrievable record on its own.

**Why this priority**: Bootstraps the index without meetings and lowers capture friction, but the
manual write path (US1) and the safety boundary (US2) must land first. Sequenced as the second ship.

**Independent Test**: Feed a decision-bearing merged PR and a routine one; assert exactly one candidate
from the former, none from the latter, each `unconfirmed` with a source link and never auto-confirmed.

**Acceptance Scenarios**:

1. **Given** a merged PR/closed issue with a clear decision signal, **When** it is processed, **Then**
   one `unconfirmed` candidate is created with pre-filled fields and a source reference.
2. **Given** a routine merged PR with no decision signal, **When** it is processed, **Then** no
   candidate is created.
3. **Given** any auto-suggested candidate, **When** it is created, **Then** it is never retrievable
   until a human confirms it.

### Edge Cases

- **Manually captured decision with no source link** → status surfacing shows existence + queue link
  without a source pointer (no "from PR #17"); it must still never leak content.
- **Small corpus (few records)** → an unrelated nearest-neighbour must not be surfaced as a relevant
  candidate; a relevance cutoff governs whether anything is shown (see Assumptions / open item).
- **Question is about a user's own recent activity, not a decision** → no decision status metadata is
  attached (the boundary is source-driven; irrelevant sources stay quiet).
- **Confirming an already-confirmed or superseded record** → idempotent no-op; state never regresses.
- **Cross-tenant** → no capture, confirm, search, or status surfacing ever crosses a workspace
  boundary.

## Requirements *(mandatory)*

### Functional Requirements

**Capture & lifecycle (US1, US3, US4 — F10.1/F10.4)**

- **FR-001**: Users MUST be able to create a decision record (title, decision, rationale, options,
  owner, source reference); it is stored as `unconfirmed`.
- **FR-002**: A newly created record MUST be made matchable to questions at creation time (so its
  existence can be surfaced) **without** becoming grounding evidence.
- **FR-003**: A person MUST be able to confirm an unconfirmed record in one action; the system MUST
  record who confirmed it and when, and only then make it retrievable.
- **FR-004**: The system MUST allow superseding a confirmed record with a new confirmed record, link
  the two, mark the old one `superseded`, and exclude superseded records from retrieval.
- **FR-005**: A reviewer MUST be able to dismiss an unconfirmed candidate; dismissed candidates MUST
  never ground an answer, never appear as status metadata, and never be re-suggested for the same
  source item.
- **FR-006**: All lifecycle transitions MUST be idempotent and MUST NOT regress state (e.g.
  confirming twice, superseding an already-superseded record).

**Source boundary & answers (US2 — Constitution II, F7.2/R4/R20, R23)**

- **FR-007**: Only `confirmed` records MAY ground an answer or be cited. Unconfirmed, dismissed, and
  superseded records MUST NOT ground any answer.
- **FR-008**: Unconfirmed decision content (decision text, rationale, options) MUST NEVER appear in
  generated answer text or in any citation. Only existence, a source pointer, and a queue link may be
  surfaced about an unconfirmed candidate.
- **FR-009**: For any question, the system MUST resolve decision status into exactly one of: **none**,
  **proposed_unconfirmed**, **confirmed (settled)**, **superseded** — and a `settled` answer MUST be
  able to additionally carry a **pending change** signal (metadata only) when a relevant unconfirmed
  candidate also exists.
- **FR-010**: When no confirmed evidence and no relevant unconfirmed candidate exist, the system MUST
  stay silent about decisions (grounded-or-silent), never guessing.
- **FR-011**: A confirmed decision cited in an answer MUST link to that decision's detail view.
- **FR-012**: The status resolution MUST be source-driven (it fires only when a relevant decision
  candidate surfaces), NOT question-type routing; the general Q&A remains general-purpose.

**Presentation (US1)**

- **FR-013**: Users MUST be able to view an unconfirmed queue and act on each item (confirm / edit /
  supersede / dismiss).
- **FR-014**: Users MUST be able to open a decision detail view showing decision, rationale, dissent,
  owner, options, source, status, confirmer/at, supersede chain, and a freshness flag past the
  workspace horizon.

**Auto-suggest (US5 — Ship 2)**

- **FR-015**: The system MUST conservatively derive candidate decisions from merged PRs / closed
  issues into the unconfirmed queue with pre-filled fields and a source reference, biased toward
  fewer, clearer candidates.
- **FR-016**: Auto-suggested candidates MUST never be retrievable until a human confirms them
  (Falcon proposes; humans dispose).

**Cross-cutting invariants (Constitution III, V)**

- **FR-017**: Every capture, confirm, supersede, dismiss, search, and status operation MUST be
  tenant-isolated at the database layer (RLS); nothing crosses a workspace boundary (§12.9/R25).
- **FR-018**: Any model used for embeddings or auto-suggestion MUST be a pinned version, never
  `-latest` (§12.8/R22).

### Key Entities *(include if feature involves data)*

- **Decision Record**: A team decision — title, decision, rationale, options, dissent, owner, source
  reference, revisit date, freshness. Lifecycle state: `unconfirmed → confirmed → superseded`, plus an
  orthogonal `dismissed` marker for rejected candidates. Only `confirmed` records are retrievable.
  Records may link to the record they supersede.
- **Unconfirmed Candidate**: A Decision Record in the `unconfirmed` state awaiting human ratification —
  manually captured or auto-suggested. Surfaced only as metadata (existence + source pointer + queue
  link).
- **Decision Status (answer metadata)**: The resolved four-state signal attached to an answer
  (`none` / `proposed_unconfirmed` / `settled` [± `pending change`] / `superseded`), carrying only
  non-evidential metadata for unconfirmed/pending cases.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A team member can capture and confirm a decision, and then get a grounded, cited answer
  to a question about it, in a single sitting (end-to-end capture→confirm→answer succeeds).
- **SC-002**: In 100% of cases, an unconfirmed or dismissed decision's content never appears in any
  answer text or citation (zero leakage) — verified by automated tests over seeded records.
- **SC-003**: When a confirmed decision is superseded, 100% of subsequent answers on that topic
  reflect the current decision and never present the reversed one as live.
- **SC-004**: When an unconfirmed candidate is the only match, the user is correctly told the topic is
  unsettled (not "nothing on record" and not a quoted candidate) in 100% of seeded cases.
- **SC-005**: No capture, confirm, search, or status surfacing ever returns data from another
  workspace (tenant isolation holds under test, SC-003-style from feature 001).
- **SC-006** *(pilot retention — the real bet)*: ≥ 3 of 5 pilot engineers ask Falcon ≥ 2 decision
  questions (an answer that cited a decision record or carried decision status) in pilot week 2.
- **SC-007** *(G6 local proxy — the PRD's per-meeting metric is uncomputable until meeting ingestion
  lands)*: ≥ 1 decision record confirmed per active engineer per pilot week.

## Assumptions

- **Read path is already shipped and reused**: confirmed-only decision search, the general grounded
  Q&A with its provenance gate, and the `/decisions` search page. This feature extends, not replaces,
  them.
- **Decision Records are a knowledge source, not a question feature**: the Q&A stays general-purpose
  ("ask anything about your team's work"); this feature only makes the decision source safe and
  populated. New sources (e.g. meetings) plug into the same Q&A later.
- **Meetings are not an indexed source yet** (live transcript deprioritized); decision questions that
  would need meeting evidence are out of scope for this feature.
- **Relevance cutoff for surfacing an unconfirmed candidate** starts conservative (surface only very
  close matches) and is calibrated on the pilot corpus during planning — resolved as a single absolute
  distance ceiling; not a hardcoded constant in this spec. The same cutoff may be applied to confirmed
  search to prevent small-corpus false positives. *(Open item for `/speckit-plan`.)*
- **Dismiss is modeled orthogonally to the lifecycle** (a tombstone marker), not as a fourth grounding
  state, so it never complicates the confirmed/unconfirmed/superseded semantics.
- **Instrumentation from day one**: confirmations per week, unconfirmed-queue age, decision questions
  per engineer-week, and how often answers carry a pending/proposed status footer (early warning that
  the relevance cutoff is too loose).

## Scope / Sequencing

- **Ship 1 (US1, US2, US3, US4)**: manual write path + lifecycle + the four-state answer boundary +
  detail view + clickable citations. Makes the source real and safe end-to-end.
- **Ship 2 (US5)**: conservative auto-suggest from merged PRs / closed issues into the same queue.
- **Out of scope** (roadmap, not now): meeting ingestion as a retrieval source; live mediation cards
  (Phase 3 US2/US3 → Phase 4); Decision Index pruning/tiering at multi-year scale (PRD §18); any flow
  where Falcon auto-creates tasks or executes actions (conflicts with human-in-the-loop).
