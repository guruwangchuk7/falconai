# Contract: HTTP Surface (Next.js route handlers, `apps/web`)

**Feature**: `specs/001-context-layer`. All routes are workspace-scoped via the authenticated
session (Auth.js) → active membership → `app.workspace_id`. No token values ever cross these
boundaries; only `secret_ref` pointers.

## Auth
- `GET/POST /api/auth/*` — Auth.js (sign up, sign in, session). Establishes user identity.
- Active workspace is resolved from `membership`; switching workspace re-scopes all queries.

## Integrations (FR-002/003/016, §10 /integrations)
- `POST /api/integrations/github/connect` → starts GitHub App install flow; on callback, stores
  the installation and writes the token to the **secrets store**, persisting only `secret_ref`.
- `POST /api/integrations/linear/connect`, `.../jira/connect` — OAuth connect; same token-handling rule.
- `GET  /api/integrations` → list connections with `{provider, status, lastSyncedAt, staleness}`
  for the dashboard status view.
- `POST /api/integrations/{id}/disconnect` → revoke locally; stop syncing; mark `disconnected`.

## Webhooks (FR-005; receive → enqueue only, never process inline)
- `POST /api/webhooks/github` — verify signature; enqueue a `sync-github` job with the delta; 202.
- `POST /api/webhooks/linear` — verify signature; enqueue `sync-linear`; 202.
- Rule: handlers do NO DB writes to artifacts directly — they enqueue to BullMQ so retries,
  backoff, and ordering live in one place (the worker).

## Work Digest (FR-009/010, §10 /me/digest)
- `GET /api/me/digest` → `{ generatedText, editedText, effectiveText, generatedAt, editedAt }`.
- `PUT /api/me/digest` `{ text }` → sets `edited_text`; `effectiveText` becomes the edit (trust
  valve). 200.

## Decision Index (FR-011/012, §10 /decisions)
- `GET /api/decisions?q=…` → confirmed-only, recency-weighted, each with `{ current: bool,
  freshnessFlag: bool, supersedesId? }`. Never returns unconfirmed/superseded-as-current.

## Internal retrieval (eval + later phases)
- `POST /api/retrieval` `{ query, k, sources }` → `RetrieveResult` (see `retrieval.md`). Scoped
  to the caller's workspace + user; same ACL/provenance guarantees. Not a public API.

## Cross-cutting
- Every handler: authenticated → membership-checked → runs data access through the
  `packages/db` tenant-context helper (transaction + `set local`). A handler that touches
  tenant data without the helper is a review-blocking defect.
- Errors are explicit and typed; no silent 200 on a failed write (Constitution IV).
