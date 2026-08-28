# Feature Specification: Context Layer (Phase 1 — the moat)

**Feature Branch**: `001-context-layer`

**Created**: 2026-08-28

**Status**: Draft

**Input**: Phase 1 Context Layer per PRD F2 and §17 Phase 1. Sync each participant's GitHub/Linear/Jira work on a rolling 30-day window, index it with per-user/per-repo ACLs under tenant isolation, maintain a Personal Work Digest and the Org Decision Index, and expose a minimal dashboard. No audio, pairing, agents, or coordinator.

> **Traceability (Constitution I).** This feature implements PRD F1 (setup/integrations),
> F2 (context ingestion), the retrieval half of F7.2 (provenance), F10.1 (decision lifecycle),
> §12.9 (tenant isolation + secrets), §15.1 (integration reliability), and the §10 dashboard
> surfaces `/integrations`, `/me/digest`, `/decisions`. It is PRD §17 **Phase 1** and is
> explicitly architecture-independent — the foundation the card-quality gate and the
> Wizard-of-Oz test depend on.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect my work and have it indexed, retrievable, and access-safe (Priority: P1)

An engineer signs up, creates or joins a workspace, sets a role, and connects their GitHub
(repo-scoped). Within minutes their recent pull requests, commits, and review comments are
synced and become retrievable context — tagged so a person can only ever retrieve artifacts
they already have access to, and so no other company's data is ever reachable. This is the
whole moat in one slice: Falcon can see a person's real work and surface it securely.

**Why this priority**: Nothing else in the product functions without secure, indexed context.
It is the minimum that delivers value (Falcon "has read what you wrote") and it carries the
non-negotiable security spine (tenant isolation, ACL-tagged retrieval). If only this ships,
the workspace already has a private, access-safe index of its engineering work.

**Independent Test**: Connect one GitHub account in a test workspace, wait for initial sync,
then issue retrieval requests as different users and from a second workspace — verify the
right artifacts return for the owner and that private-repo and cross-workspace artifacts
never leak.

**Acceptance Scenarios**:

1. **Given** a connected GitHub account, **When** the initial sync completes, **Then** the user's PRs, commits, and review comments from the last 30 days are indexed and retrievable.
2. **Given** an artifact from a private repo, **When** a user without access to that repo retrieves context, **Then** that artifact is never returned.
3. **Given** two workspaces with indexed data, **When** either retrieves context, **Then** no artifact belonging to the other workspace is ever returned, even under a query crafted to cross the boundary.
4. **Given** a PR is merged during an active meeting window, **When** the live-update path fires, **Then** the artifact is retrievable within minutes rather than waiting for the next scheduled backfill.
5. **Given** a retrieval request, **When** it returns results, **Then** every result resolves to a real, access-checked artifact — no fabricated or inaccessible references.

---

### User Story 2 - See and correct what Falcon thinks I've been working on (Priority: P2)

A workspace member opens their Work Digest and sees a plain-language summary of what they have
been doing recently, regenerated nightly. If it is wrong, they can edit it, and their
correction sticks. This is the trust valve that defuses "an AI is watching me."

**Why this priority**: The digest is the user-facing trust surface and the compiled context
injected downstream. Without a way to see and correct it, adoption erodes on privacy fear.
It depends on US1's synced data.

**Independent Test**: After US1 sync, confirm a digest is generated for the user, edit it, and
verify the edit persists and is used in place of the generated version.

**Acceptance Scenarios**:

1. **Given** synced work, **When** the nightly digest runs, **Then** the user sees an accurate concise summary of their recent work.
2. **Given** an inaccurate digest, **When** the user edits it, **Then** the edit persists and takes precedence over the regenerated version.
3. **Given** a user with no activity in the window, **When** the digest generates, **Then** it shows an honest low-activity state and never fabricates work.

---

### User Story 3 - Search the org's past decisions, and add more sources (Priority: P3)

A member connects Linear and/or Jira so issues, estimates, and comments join the index, and
can search the Org Decision Index for past decisions — seeing the current version of a
decision, ranked by recency, with a staleness flag on old ones, and never seeing an
unconfirmed or superseded decision presented as current.

**Why this priority**: Broadens coverage and starts the compounding decision-memory moat, but
the product is already useful with GitHub alone (US1) and the digest (US2).

**Independent Test**: Connect Linear in a test workspace, confirm issues index; seed the
Decision Index with sample decisions in each lifecycle state and confirm only confirmed ones
are returned by search, recency-ranked, with freshness flags.

**Acceptance Scenarios**:

1. **Given** a connected Linear/Jira account, **When** sync completes, **Then** issues, estimates, and comments from the last 30 days are indexed and retrievable under the same ACL rules as US1.
2. **Given** decisions in unconfirmed, confirmed, and superseded states, **When** a user searches the Decision Index, **Then** only confirmed decisions are returned, the current record is surfaced over a superseded one, and results older than the workspace freshness horizon are flagged.

---

### Edge Cases

- **Integration rate limit during sync** → back off and resume from a saved cursor; never storm on recovery; sync progress is visible, not silently stalled.
- **Sync fails or stalls** → affected data is marked stale (with a last-synced time) rather than served silently as current.
- **OAuth token revoked / source disconnected** → syncing stops for that source, it shows a disconnected state, and the rest of the dashboard keeps working.
- **Artifact contains instruction-like content** ("ignore previous instructions…") → tagged untrusted at ingestion so it is never treated as an instruction by any later consumer.
- **A user belongs to multiple workspaces** → artifacts are scoped per workspace; nothing bleeds across them.
- **Two users share a repo** → both can retrieve that repo's artifacts; a repo private to one is never retrievable by the other.
- **Very large history** → retrieval is bounded to the rolling 30-day window; older artifacts are out of scope for Phase 1.
- **A source returns stale state** (e.g., a PR shown open that has since merged) → freshness is tracked per artifact so a downstream consumer can tell fresh from stale.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (F1.1, F1.6): Users MUST be able to sign up, create or join a workspace, and set a role.
- **FR-002** (F1.4): Users MUST be able to connect GitHub with repo-scoped access.
- **FR-003** (F1.4): Users MUST be able to connect Linear and/or Jira.
- **FR-004** (F2.1): The system MUST sync each user's GitHub PRs, commits, and review comments and Linear/Jira issues, estimates, and comments over a rolling 30-day window.
- **FR-005** (§15.1): The system MUST keep active artifacts near-real-time via a live-update path and backfill the historical window via scheduled polling, respecting each source's rate limits with backoff and per-source sync cursors.
- **FR-006** (F2.2): The system MUST index synced artifacts for semantic retrieval, each tagged with per-user and per-repo access controls.
- **FR-007** (§12.9, R25 — Constitution III): The system MUST enforce tenant isolation at the data layer such that no retrieval can return another workspace's artifacts even if an application-layer filter is omitted.
- **FR-008** (F7.2, R20 — Constitution III): Ingested artifact content MUST carry a trust classification set at ingestion, so content from attacker-influenceable sources is never treated as instructions by any downstream consumer.
- **FR-009** (F2.3): The system MUST generate a concise Personal Work Digest per user, regenerated on a nightly cadence.
- **FR-010** (§10 `/me/digest`): Users MUST be able to view and edit their own Work Digest; edits persist and take precedence over the regenerated version.
- **FR-011** (F2.4): The system MUST maintain an Org Decision Index that is searchable, recency-weighted, and flags entries older than a workspace-set freshness horizon.
- **FR-012** (F10.1, R23 — Constitution IV): Only confirmed decision records MUST be retrievable; unconfirmed records are excluded and superseded records are never presented as current.
- **FR-013** (§15.1): On sync failure or staleness, the system MUST mark the affected data stale rather than serve it silently as current, and MUST surface the degraded state.
- **FR-014** (R26, §12.9 — Constitution III): Third-party OAuth credentials MUST be stored in a dedicated secrets store separate from application data.
- **FR-015** (§12.7, §12.8, R21/R22 — Constitution V): Every generative judgment (e.g., digest generation) MUST be logged with its inputs for evaluation, and the model version MUST be pinned (never "latest").
- **FR-016** (§10 `/integrations`): Users MUST be able to see the connection and sync status (including last-synced time and any staleness) of each integration.
- **FR-017** (F7.2 retrieval half — Constitution II): A retrieval request MUST return only real, access-checked artifacts and MUST NOT fabricate references or return content the requester cannot access.

### Key Entities *(include if feature involves data)*

- **Workspace** — the tenant boundary; owns all members, connections, artifacts, digests, and decisions. Every other entity is scoped to exactly one workspace.
- **User** — a member of a workspace, with a role; owns their connections and digest.
- **Connection** — a link to an external source (GitHub / Linear / Jira) for a user or workspace, with status and last-synced time. Credentials are held in the separate secrets store, not on this record.
- **Artifact** — a synced unit of work (PR, commit, review comment, issue, estimate, comment). Carries its source, type, owner, repo/project, access-control tags, trust classification, freshness, and indexed content.
- **Personal Work Digest** — a per-user summary with a generated version and an optional user-edited version that takes precedence.
- **Decision Record** — a past decision with a lifecycle state (unconfirmed / confirmed / superseded), recency, and links to the record it supersedes. Only confirmed records are retrievable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After connecting GitHub, a typical user's last-30-day PRs, commits, and review comments are retrievable within 10 minutes of initial sync.
- **SC-002**: A newly merged PR becomes retrievable within 5 minutes via the live-update path, without waiting for the scheduled backfill.
- **SC-003**: Across an adversarial isolation test suite, zero artifacts leak across workspaces or to users without access (100% isolation, no exceptions).
- **SC-004**: Every retrieval result resolves to a real, access-checked artifact — 0 fabricated or inaccessible references across the test corpus.
- **SC-005**: For a labeled retrieval set, the system returns the relevant artifacts for a topic at or above the recall@k bar set for the card-quality gate.
- **SC-006**: At least 90% of users shown their Work Digest rate it an accurate summary of their recent work (or leave it unedited).
- **SC-007**: A sync failure or disconnection surfaces as a visible stale/disconnected state within 5 minutes; no silently-stale artifact is served as current.
- **SC-008**: Decision Index search never returns an unconfirmed or superseded-as-current record across the test set (100%).

## Assumptions

- **Scope is Phase 1 only.** Audio capture, VAD, STT, pairing/sessions, participant agents, the Coordinator, and mediation cards are out of scope (later phases). Calendar connection and auto-pairing are Phase 3 and out of scope here; Phase 1 includes identity mapping (linking GitHub/Linear identities to workspace users).
- **Retrieval is consumed internally in Phase 1** — by the card-quality eval and later phases — plus the two human-facing surfaces the dashboard exposes (Decision Index search and the Work Digest). A general artifact-search UI is not required in Phase 1.
- **Beachhead sources.** GitHub and Linear are primary; Jira is supported behind the same interface. Notion and Slack are out of scope for Phase 1.
- **Decision Index seeding.** Because the Coordinator (which generates Decision Records) is a later phase, the Phase 1 Decision Index is seeded from a workspace's designated existing decision source (e.g., an ADR folder) if one exists; otherwise it starts empty and fills as records are confirmed later. Bulk historical import beyond a designated source is out of scope. *(Candidate for `/speckit-clarify`.)*
- **The workspace already uses GitHub and Linear/Jira** and can grant repo-scoped / minimal-scope access.
- **The 30-day rolling window** bounds both sync and retrieval; older history is out of scope for Phase 1 (long-horizon retention/tiering is PRD Open Question 4, deferred).
