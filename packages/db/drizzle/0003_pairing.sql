-- 0003_pairing.sql — Phase 3 (Pairing) tenant-scoped tables (T008).
-- Mirrors the 0001/0002 pattern: workspace_id-keyed PK, RLS ENABLE + FORCE + fail-closed isolation
-- policy, granted to falcon_app (the non-BYPASSRLS runtime role). Not partitioned (low volume).
-- Runs as the DB owner (DATABASE_URL); the app connects as falcon_app (APP_DATABASE_URL).
-- Live session state (merged transcript, open-thread folds) lives in Redis and is replayed (CX-1);
-- these tables hold durable/finalized data. Raw audio is never persisted (§12.3/R6).

create table session (
  id                  uuid not null default gen_random_uuid(),
  workspace_id        uuid not null,
  session_key         text not null,
  origin              text not null check (origin in ('calendar','team_auto','code')),
  status              text not null default 'active' check (status in ('active','ended')),
  owner_fencing_token bigint not null default 0,
  retention_class     text not null default 'standard',
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  primary key (workspace_id, id)
);

create table session_membership (
  id            uuid not null default gen_random_uuid(),
  workspace_id  uuid not null,
  session_id    uuid not null,
  user_id       uuid not null,
  role_profile  text not null default 'engineer',
  join_origin   text not null check (join_origin in ('calendar','team_auto','code')),
  consent_state text not null default 'granted' check (consent_state in ('granted','revoked')),
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,
  primary key (workspace_id, id)
);

create table session_code (
  id           uuid not null default gen_random_uuid(),
  workspace_id uuid not null,
  session_id   uuid not null,
  code         text not null,
  scope        text not null default 'workspace' check (scope in ('workspace','cross_workspace')),
  max_joins    integer not null default 10,
  join_count   integer not null default 0,
  created_by   uuid not null,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, code)
);

create table consent_pair (
  id                 uuid not null default gen_random_uuid(),
  workspace_id       uuid not null,                 -- initiating workspace = RLS scope
  user_lo            uuid not null,                 -- canonical-ordered pair
  user_hi            uuid not null,
  is_cross_workspace boolean not null default false, -- if true, always re-prompt (§7.2)
  granted_at         timestamptz,
  revoked_at         timestamptz,
  primary key (workspace_id, id),
  unique (workspace_id, user_lo, user_hi),
  check (user_lo < user_hi)
);

create table open_thread (
  id                uuid not null default gen_random_uuid(),
  workspace_id      uuid not null,
  session_id        uuid not null,
  topic_embedding   vector(1024),
  embedding_model   text,
  embedding_version text,
  first_seen_seq    bigint not null,
  last_seen_seq     bigint not null,
  status            text not null default 'open' check (status in ('open','merged','split')),
  merged_into       uuid,
  primary key (workspace_id, id)
);

create table session_visibility_scope (
  id                 uuid not null default gen_random_uuid(),
  workspace_id       uuid not null,
  session_id         uuid not null,
  membership_version integer not null,
  artifact_scope     jsonb not null,
  computed_at        timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, session_id)
);

create table session_event (
  id           uuid not null default gen_random_uuid(),
  workspace_id uuid not null,
  session_id   uuid not null,
  seq          bigint not null,
  type         text not null,
  payload      jsonb not null,    -- NO raw audio (§12.3)
  created_at   timestamptz not null default now(),
  primary key (workspace_id, id)
);

-- ---------- indexes ----------
create index session_ws_key_idx          on session (workspace_id, session_key);
create index session_membership_ws_sess  on session_membership (workspace_id, session_id);
create index session_membership_ws_user  on session_membership (workspace_id, user_id);
create index session_code_lookup_idx     on session_code (workspace_id, code);
create index consent_pair_lookup_idx     on consent_pair (workspace_id, user_lo, user_hi);
create index open_thread_ws_sess_idx     on open_thread (workspace_id, session_id);
create index session_event_ws_sess_seq   on session_event (workspace_id, session_id, seq);

-- ---------- RLS: enable + FORCE + fail-closed isolation policy on every new tenant table ----------
do $$
declare t text;
begin
  foreach t in array array[
    'session','session_membership','session_code','consent_pair',
    'open_thread','session_visibility_scope','session_event'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$
      create policy %I on %I
        using (workspace_id = current_setting('app.workspace_id', true)::uuid)
        with check (workspace_id = current_setting('app.workspace_id', true)::uuid)
    $f$, t || '_tenant_isolation', t);
  end loop;
end $$;

-- ---------- grants to the runtime role (falcon_app must NOT own these and has no BYPASSRLS) ----------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'falcon_app') then
    grant select, insert, update, delete on
      session, session_membership, session_code, consent_pair,
      open_thread, session_visibility_scope, session_event to falcon_app;
  end if;
end $$;
