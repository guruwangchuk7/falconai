# Phase 1 Data Model: Context Layer

**Feature**: `specs/001-context-layer` | **Date**: 2026-08-28

Phase-1 subset of PRD §14, with this session's decisions applied: `vector(1024)`,
`embedding_model`/`embedding_version` per row, `trust_tier` on chunks, hash-partition by
`workspace_id`, RLS on every tenant table. Session/audio/agent/coordinator tables are OUT of
scope (later phases). This is design intent; concrete Drizzle migrations are produced in
implementation.

## Tenant-isolation invariants (apply to every tenant-scoped table)

- Column `workspace_id uuid not null` on every tenant table.
- `alter table … enable row level security; alter table … force row level security;`
- Policy: `using (workspace_id = current_setting('app.workspace_id')::uuid)` (and `with check`
  the same on writes).
- The app DB role has **no `BYPASSRLS`**, is **not** the table owner.
- Every query runs inside a transaction that does `set local app.workspace_id = $1` first
  (the `packages/db` tenant-context helper); pooling is **transaction mode** (Supavisor).
- Tables holding vectors are **hash-partitioned by `workspace_id`**; the tenant predicate must
  prune partitions (CI asserts `Partitions removed` in `EXPLAIN`).

## Entities

### workspace  (tenant root)
`id uuid pk` · `name text` · `settings_jsonb` (`freshness_horizon_days`, `retention_days`) ·
`created_at`. RLS: members only.

### user  (global identity)
`id uuid pk` · `email text unique` · `name text` · `github_login text` · `linear_id text` ·
`created_at`. Not workspace-scoped (a person can join many workspaces).

### membership  (user ↔ workspace, many-to-many; PRD edge case)
`id uuid pk` · `user_id → user` · `workspace_id → workspace` · `role text`
(engineer/pm/qa/…, PRD F11) · `created_at`. Gates which `workspace_id` a session may set as
tenant context. Unique `(user_id, workspace_id)`.

### connection  (an integration link; FR-002/003/016)
`id uuid pk` · `workspace_id` · `user_id` · `provider text` (`github|linear|jira`) ·
`status text` (`active|disconnected|error`) · `external_account_ref text` ·
`secret_ref text` (pointer into the **secrets store** — NEVER the token) ·
`sync_cursor jsonb` · `last_synced_at timestamptz` · `last_error text` · `created_at`.
RLS by workspace_id.

### artifact  (a synced unit of work; F2.1/F2.2)  — **hash-partitioned by workspace_id**
`id uuid` · `workspace_id` · `user_id` (owner) · `source text` (`github|linear|jira`) ·
`external_ref text` (e.g. `#482`, `ENG-217`) · `type text` (`pr|commit|review_comment|issue|estimate|comment`) ·
`title text` · `body text` · `repo_or_project text` · `acl_tags jsonb` (repos/projects the
artifact belongs to — the retrieval ACL) · `trust_tier text` (`trusted|mixed|untrusted`) ·
`source_updated_at timestamptz` · `last_synced_at timestamptz` · `is_stale boolean` ·
`created_at`. PK `(workspace_id, id)`. Indexes: btree `(workspace_id, user_id)`,
`(workspace_id, last_synced_at)`, gin `acl_tags`.

### artifact_chunk  (retrieval unit; F2.2, F7.2)  — **hash-partitioned by workspace_id**
`id uuid` · `workspace_id` · `artifact_id` · `chunk_index int` · `content text` ·
`trust_tier text` · `embedding vector(1024)` · `embedding_model text` ·
`embedding_version text`. PK `(workspace_id, id)`. Vector index per partition (exact kNN on
small partitions; HNSW where size warrants — review A2). **ANN queries filter
`embedding_model = <current>`** so vector spaces never mix (A4); sub-partition by model is a
later optimization.

### work_digest  (Personal Work Digest; F2.3, §10 /me/digest)
`id uuid pk` · `workspace_id` · `user_id` · `generated_text text` · `generated_at` ·
`model text` · `model_version text` · `edited_text text` (nullable) · `edited_at`.
**Retrieval/injection uses `edited_text` when present, else `generated_text`** (FR-010, trust
valve). One current row per `(workspace_id, user_id)`; history optional.

### decision_record  (Org Decision Index; F2.4/F10.1)  — **hash-partitioned by workspace_id**
`id uuid` · `workspace_id` · `title` · `decision text` · `options_jsonb` · `rationale text` ·
`dissent text` · `owner_user_id` · `status text` (`unconfirmed|confirmed|superseded`) ·
`supersedes_id uuid` (nullable) · `confirmed_by` · `confirmed_at` · `source_ref text`
(where it was imported/seeded from) · `revisit_at` · `embedding vector(1024)` ·
`embedding_model` · `embedding_version` · `created_at`. PK `(workspace_id, id)`.
**Only `status = 'confirmed'` is retrievable** (FR-012); retrieval is recency-weighted and
flags rows older than `workspace.settings.freshness_horizon_days`.

### sync_run  (observability + staleness; §15.1)
`id uuid pk` · `workspace_id` · `connection_id` · `started_at` · `finished_at` · `status text`
(`ok|partial|failed`) · `error text` · `artifacts_synced int`. Drives the /integrations status
view and staleness marking.

> LLM digest-generation calls are logged to **Langfuse** (external) with inputs (FR-015), not a
> local table. No redaction/audit-log table in Phase 1 (nothing is published yet).

## Relationships

```
workspace 1─* membership *─1 user
workspace 1─* connection *─1 user
workspace 1─* artifact 1─* artifact_chunk
workspace 1─* work_digest *─1 user
workspace 1─* decision_record  (supersedes_id → decision_record, same workspace)
workspace 1─* sync_run *─1 connection
```

## State transitions

- **connection.status**: `active → error` (sync failure) → `active` (recovery); `active → disconnected` (token revoked). Never silently stuck (FR-013, FR-016).
- **artifact.is_stale**: `false → true` when its connection's sync fails or exceeds the freshness horizon; back to `false` on successful re-sync.
- **decision_record.status**: `unconfirmed → confirmed` (human ratifies, F10.4 — later phases create these; Phase 1 may seed already-confirmed imports) → `superseded` (a newer record links via `supersedes_id`). Only `confirmed` is retrievable.

## Validation rules

- `artifact.trust_tier` and `artifact_chunk.trust_tier` are NOT NULL, set at ingestion (FR-008).
- `connection.secret_ref` is a pointer; a token value in any app-DB column is a schema violation (FR-014, R26).
- Every vector row has non-null `embedding_model` + `embedding_version` (A4).
- `work_digest`: `edited_text` supersedes `generated_text` wherever the digest is consumed.
- Retrieval MUST filter `status='confirmed'` for decision records and enforce `acl_tags`
  membership against the requester (FR-012, FR-017).
