# Contract: REST — Pairing, Consent, Session Lifecycle

Session bootstrap and membership over HTTP (the WS/SSE channels carry the live stream). All routes are
Auth.js-authenticated and workspace-scoped; all reads/writes run through `withTenant` on `falcon_app`
(RLS enforced at the DB layer, §12.9). Routes live in `apps/web` (or a thin gateway to the worker).

## Discovery / bootstrap (F7, F3)

### `POST /api/session/resolve`
Resolve or create the session for the caller (calendar-first, F7.1).
- body: `{ calendar_event_id? }` — if omitted, server tries the caller's current calendar event.
- 200: `{ session_id, origin, needs_consent: bool, consent_pairs?: [...] }`
- Behavior: shared calendar event id → same session automatically (F7.1). Sets `needs_consent` if any
  co-member pair lacks a live internal consent, or is cross-workspace (§7.2).

### `POST /api/session/team-auto/ack`
Accept a team auto-pair prompt (F7.2).
- body: `{ candidate_session_id }` (offered when a same-workspace member spoke within 90s)
- 200: `{ session_id }` · 410 if the 90s window closed.

### `POST /api/session/join-by-code`
Fallback join (F7.3).
- body: `{ code }`
- 200: `{ session_id }` · 404 unknown · 410 expired · 429 rate-limited · 403 out of scope.
- Every attempt logged; a successful join emits a visible join event (F7.3).

### `POST /api/session/{id}/code`
Mint a session code (F7.3) → `{ code, expires_at, max_joins, scope }` (TTL + rate-limit + scope set).

## Consent (§7.2)

### `POST /api/consent/pair`
Record once-per-pair consent.
- body: `{ other_user_id, granted: bool }`
- 200: `{ consent_state }`. Internal pair → remembered (auto-pair thereafter). Cross-workspace →
  recorded but **always re-prompted** next session (`is_cross_workspace = true`).

### `DELETE /api/consent/pair/{other_user_id}`
Revoke → future sessions re-prompt.

## Membership / lifecycle

### `POST /api/session/{id}/leave`
Graceful leave → `member_left`, agent torn down, `session_visibility_scope` recomputed (F9.1a).

### `GET /api/session/{id}`
Session metadata + current membership (no transcript body — that's the SSE stream). 403 for
non-members.

## Invariants (contract-tested)

1. **Consent gate**: a session cannot start capturing for a pair whose first-ever pairing lacks a
   granted consent; cross-workspace always re-prompts regardless of history (§7.2). *(test)*
2. **Code safety**: expired / over-limit / out-of-scope / rate-limited joins are rejected with the
   codes above — a leaked code is bounded (F7.3). *(test)*
3. **Tenant isolation**: every route resolves only rows in the caller's `workspace_id` via RLS; a
   cross-tenant `session_id` returns 404, never data (§12.9/R25). *(test)*
4. **Visibility recompute**: any join/leave bumps `membership_version` and recomputes
   `session_visibility_scope` before the next capture proceeds (F9.1a). *(test)*
5. **No publishing routes**: there is no card/nudge/decision-record endpoint in this phase (FR-023).
