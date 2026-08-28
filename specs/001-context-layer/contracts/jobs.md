# Contract: Background Jobs (BullMQ, `apps/worker`)

**Feature**: `specs/001-context-layer`. Workers own all sync/index/digest work so retries,
backoff, ordering, and rate-limit handling live in one place (§15.1, FR-005/013). Redis
(Upstash) backs the queues + sync cursors. Every job reads OAuth tokens from the **secrets
store** by `secret_ref` (never the app DB).

## `sync-github`  /  `sync-linear`  /  `sync-jira`
- **Trigger**: webhook (active) or `poll-backfill` (historical). Payload: `{ workspaceId, connectionId, delta? }`.
- **Does**: fetch changed artifacts within the 30-day window via the source adapter
  (`packages/integrations`); upsert `artifact` rows (mapped to the common shape); enqueue
  `index-artifact` per changed artifact; advance `connection.sync_cursor`; write a `sync_run`.
- **Rules**: respect source rate limits with exponential backoff; on failure, mark affected
  artifacts `is_stale=true` and `connection.status='error'` (never drop silently); idempotent on
  `(workspace_id, source, external_ref)`.

## `index-artifact`
- **Payload**: `{ workspaceId, artifactId }`.
- **Does**: chunk the artifact (type-aware, `packages/core`); assign `trust_tier` per chunk
  (FR-008); embed each chunk via the provider (`voyage-code-4`, storing `embedding_model` +
  `embedding_version`); upsert `artifact_chunk` rows.
- **Rules**: idempotent (re-index replaces prior chunks for the artifact); embedding model/version
  recorded per row; runs inside the tenant-context transaction.

## `generate-digest`  (nightly, per user; F2.3)
- **Trigger**: nightly schedule per `(workspace, user)`.
- **Does**: assemble the user's recent artifacts → Claude Haiku (pinned) via `packages/llm` →
  800–1200-token summary → upsert `work_digest.generated_text`; log the call to Langfuse with
  inputs (FR-015). Never overwrites `edited_text`.
- **Rules**: honest empty state when there's no activity (FR: no fabricated work); model pinned.

## `poll-backfill`  (scheduled; §15.1)
- **Does**: for each active connection, reconcile the 30-day window (catch missed webhook events),
  advancing cursors; enqueue `sync-*` deltas. Marks stale connections.

## Cross-cutting
- All jobs run through the `packages/db` tenant-context helper (`set local app.workspace_id`).
- Bounded concurrency; dead-letter on repeated failure with a visible `sync_run.status='failed'`.
- No job writes tokens to the app DB; tokens are fetched from the secrets store per run.
