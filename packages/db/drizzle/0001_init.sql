-- Context Layer (Phase 1) — initial schema + tenant-isolation spine.
-- Traces: PRD §12.9 / R25 (tenant isolation at the DB layer), review A2 (RLS floor +
-- hash-partitioning), constitution III. This migration is authoritative for RLS and
-- partitioning (Drizzle schema.ts mirrors columns for the query builder only).
--
-- SECURITY MODEL
--   * Every tenant DATA table has workspace_id + RLS ENABLED and FORCED.
--   * Policy predicate uses current_setting('app.workspace_id', true) with missing_ok=true,
--     so with NO tenant context set the predicate is `= NULL` → zero rows (FAIL-CLOSED).
--   * The app connects as a role WITHOUT BYPASSRLS and is NOT the table owner; FORCE RLS
--     makes the policy apply even to the owner (belt and suspenders).
--   * Tenant context is set per-transaction via set_config('app.workspace_id', $1, true)
--     — see packages/db/src/tenant.ts. Requires TRANSACTION-MODE pooling.
--   * Identity tables (workspace, "user", membership) are managed by the auth service path
--     with explicit membership checks; they are NOT under app.workspace_id RLS because the
--     membership lookup is what CHOOSES the workspace before context exists.

create extension if not exists vector;      -- pgvector >= 0.8 (iterative index scans)
create extension if not exists pgcrypto;    -- gen_random_uuid()

-- ---------- identity / tenant root (auth-service path) ----------

create table workspace (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  settings    jsonb not null default '{"freshness_horizon_days":180,"retention_days":null}'::jsonb,
  created_at  timestamptz not null default now()
);

create table "user" (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text,
  github_login  text,
  linear_id     text,
  created_at    timestamptz not null default now()
);

create table membership (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references "user"(id) on delete cascade,
  workspace_id  uuid not null references workspace(id) on delete cascade,
  role          text not null default 'engineer',
  created_at    timestamptz not null default now(),
  unique (user_id, workspace_id)
);

-- ---------- tenant data tables (RLS + partitioning) ----------

create table connection (
  id                    uuid not null default gen_random_uuid(),
  workspace_id          uuid not null,
  user_id               uuid not null,
  provider              text not null check (provider in ('github','linear','jira')),
  status                text not null default 'active' check (status in ('active','error','disconnected')),
  external_account_ref  text,
  secret_ref            text,                 -- POINTER into the secrets store; NEVER the token (R26)
  sync_cursor           jsonb,
  last_synced_at        timestamptz,
  last_error            text,
  created_at            timestamptz not null default now(),
  primary key (workspace_id, id)
);

-- artifact + artifact_chunk + decision_record are HASH-PARTITIONED by workspace_id so the
-- tenant predicate becomes partition-pruning (review A2). PK includes the partition key.

create table artifact (
  id                uuid not null default gen_random_uuid(),
  workspace_id      uuid not null,
  user_id           uuid not null,
  source            text not null check (source in ('github','linear','jira')),
  external_ref      text not null,
  type              text not null,
  title             text,
  body              text,
  repo_or_project   text,
  acl_tags          jsonb not null default '[]'::jsonb,
  trust_tier        text not null check (trust_tier in ('trusted','mixed','untrusted')),
  source_updated_at timestamptz,
  last_synced_at    timestamptz not null default now(),
  is_stale          boolean not null default false,
  created_at        timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, source, external_ref)
) partition by hash (workspace_id);

create table artifact_chunk (
  id                uuid not null default gen_random_uuid(),
  workspace_id      uuid not null,
  artifact_id       uuid not null,
  chunk_index       int  not null,
  content           text not null,
  trust_tier        text not null check (trust_tier in ('trusted','mixed','untrusted')),
  embedding         vector(1024) not null,
  embedding_model   text not null,
  embedding_version text not null,
  primary key (workspace_id, id)
) partition by hash (workspace_id);

create table decision_record (
  id                uuid not null default gen_random_uuid(),
  workspace_id      uuid not null,
  title             text not null,
  decision          text,
  options           jsonb,
  rationale         text,
  dissent           text,
  owner_user_id     uuid,
  status            text not null default 'unconfirmed' check (status in ('unconfirmed','confirmed','superseded')),
  supersedes_id     uuid,
  confirmed_by      uuid,
  confirmed_at      timestamptz,
  source_ref        text,
  revisit_at        timestamptz,
  embedding         vector(1024),
  embedding_model   text,
  embedding_version text,
  created_at        timestamptz not null default now(),
  primary key (workspace_id, id)
) partition by hash (workspace_id);

create table work_digest (
  id             uuid not null default gen_random_uuid(),
  workspace_id   uuid not null,
  user_id        uuid not null,
  generated_text text,
  generated_at   timestamptz,
  model          text,
  model_version  text,
  edited_text    text,
  edited_at      timestamptz,
  primary key (workspace_id, id),
  unique (workspace_id, user_id)
);

create table sync_run (
  id               uuid not null default gen_random_uuid(),
  workspace_id     uuid not null,
  connection_id    uuid not null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'ok' check (status in ('ok','partial','failed')),
  error            text,
  artifacts_synced int not null default 0,
  primary key (workspace_id, id)
);

-- ---------- hash partitions (start at 16; target 32-64; whale tenants get LIST partitions later) ----------
do $$
declare
  n_parts int := 16;
  t text;
  i int;
begin
  foreach t in array array['artifact','artifact_chunk','decision_record'] loop
    for i in 0 .. n_parts - 1 loop
      execute format(
        'create table %I partition of %I for values with (modulus %s, remainder %s)',
        t || '_p' || i, t, n_parts, i
      );
    end loop;
  end loop;
end $$;

-- ---------- indexes ----------
create index artifact_ws_user_idx        on artifact (workspace_id, user_id);
create index artifact_ws_synced_idx      on artifact (workspace_id, last_synced_at);
create index artifact_acl_gin            on artifact using gin (acl_tags);
create index chunk_ws_artifact_idx       on artifact_chunk (workspace_id, artifact_id);
-- ANN index: created on the partitioned parents; cascades to partitions. Small partitions can
-- use exact kNN — drop per-partition if not warranted (review A2). Cosine distance.
create index chunk_embedding_hnsw        on artifact_chunk using hnsw (embedding vector_cosine_ops);
create index decision_ws_status_idx      on decision_record (workspace_id, status);
create index decision_embedding_hnsw     on decision_record using hnsw (embedding vector_cosine_ops);
create index connection_ws_idx           on connection (workspace_id);
create index sync_run_ws_conn_idx        on sync_run (workspace_id, connection_id);

-- ---------- RLS: enable + FORCE + fail-closed policy on every tenant data table ----------
do $$
declare t text;
begin
  foreach t in array array['connection','artifact','artifact_chunk','decision_record','work_digest','sync_run'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$
      create policy %I on %I
        using (workspace_id = current_setting('app.workspace_id', true)::uuid)
        with check (workspace_id = current_setting('app.workspace_id', true)::uuid)
    $f$, t || '_tenant_isolation', t);
  end loop;
end $$;

-- NOTE: create the app role out-of-band (infra, not this migration):
--   create role falcon_app login password '***';           -- managed by the secrets store
--   revoke all on all tables in schema public from falcon_app;
--   grant select, insert, update, delete on <tenant tables> to falcon_app;
--   -- falcon_app must NOT have BYPASSRLS and must NOT own these tables.
