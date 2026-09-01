# Contract — HTTP routes (`apps/web`)

All handlers `runtime = 'nodejs'`, gate on `getActiveSession()` (401 if absent), and act within the
session's `workspaceId` via `withTenant`. `userId` from the session supplies `ownerUserId` /
`confirmedBy`.

## `POST /api/decisions` — capture (US1)

Request: `{ title, decision?, rationale?, options?, dissent?, ownerUserId?, sourceRef? }`
→ `createDecision(...)`. **201** `{ id }`. Validation error → **400**. Unauthenticated → **401**.
Record is created `unconfirmed` and embedded; not yet retrievable.

## `GET /api/decisions?q=…` — search (EXISTING, unchanged)

Confirmed-only search results. Unchanged.

## `PATCH /api/decisions/[id]` — lifecycle (US1/US3/US4)

Request one of:
- `{ action: 'confirm' }` → `confirmDecision(id, session.userId)` → **200** `{ status }`.
- `{ action: 'supersede', supersedesId }` → the record `[id]` (must be confirmed) supersedes
  `supersedesId` → **200** `{ superseded }`.
- `{ action: 'dismiss' }` → `dismissDecision(id)` → **200** `{ dismissed }`.

Idempotent per the core contract. Acting on another workspace's record → **404** (RLS returns no row).
Illegal transition (e.g. dismiss a confirmed record) → **409**.

## Pages (server components)

- `GET /decisions` — search (existing) **+** an Unconfirmed Queue section (`listQueue`) **+** a link to
  `/decisions/new`.
- `GET /decisions/new` — the "Log a decision" form (client component posts to `POST /api/decisions`).
- `GET /decisions/[id]` — detail view: decision, rationale, dissent, owner, options, sourceRef, status,
  confirmedBy/at, supersede chain, freshness flag. This is the **citation target** (FR-011).

## Falcon panel (existing `/falcon`)

`FalconPanel.tsx` renders `answer.decisionStatus` when present: a neutral footer —
"Not settled yet — unconfirmed candidate(s) [from #482] · Open the queue" (link to
`/decisions?tab=queue`) for `proposed`/`pendingChange`; nothing extra for `settled` beyond the existing
cited answer. Confirmed-decision citations link to `/decisions/[id]`. **No unconfirmed content is ever
rendered here** — only counts, source refs, and the queue link.
