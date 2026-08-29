-- 0002_personal_falcon.sql — Phase 2 (Personal Falcon) tenant-scoped tables.
-- Mirrors the 0001 pattern: workspace_id-keyed PK, RLS ENABLE + FORCE + fail-closed isolation
-- policy, granted to falcon_app (the non-BYPASSRLS runtime role). Not partitioned (low volume).
-- Runs as the DB owner (DATABASE_URL); the app connects as falcon_app (APP_DATABASE_URL).

create table conversation (
  id           uuid not null default gen_random_uuid(),
  workspace_id uuid not null,
  user_id      uuid not null,
  title        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table question (
  id              uuid not null default gen_random_uuid(),
  workspace_id    uuid not null,
  conversation_id uuid not null,
  user_id         uuid not null,
  text            text not null,
  kind            text not null default 'qa' check (kind in ('qa','summary')),
  scope           jsonb,
  asked_at        timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table answer (
  id             uuid not null default gen_random_uuid(),
  workspace_id   uuid not null,
  question_id    uuid not null,
  status         text not null check (status in ('grounded','no_grounded_answer')),
  generated_text text,
  model          text,
  model_version  text,
  generated_at   timestamptz not null default now(),
  edited_text    text,
  edited_at      timestamptz,
  data_as_of     timestamptz,
  primary key (workspace_id, id)
);

create table answer_citation (
  id           uuid not null default gen_random_uuid(),
  workspace_id uuid not null,
  answer_id    uuid not null,
  artifact_id  uuid not null,
  chunk_id     uuid,
  claim_ref    text,
  primary key (workspace_id, id)
);

create table query_event (
  id           uuid not null default gen_random_uuid(),
  workspace_id uuid not null,
  user_id      uuid not null,
  kind         text not null default 'qa' check (kind in ('qa','summary')),
  occurred_at  timestamptz not null default now(),
  primary key (workspace_id, id)
);

-- ---------- indexes ----------
create index conversation_ws_user_idx on conversation (workspace_id, user_id, updated_at desc);
create index question_ws_conv_idx     on question (workspace_id, conversation_id);
create index answer_ws_question_idx   on answer (workspace_id, question_id);
create index answer_citation_ws_ans   on answer_citation (workspace_id, answer_id);
create index query_event_ws_user_idx  on query_event (workspace_id, user_id, occurred_at);

-- ---------- RLS: enable + FORCE + fail-closed isolation policy on every new tenant table ----------
do $$
declare t text;
begin
  foreach t in array array['conversation','question','answer','answer_citation','query_event'] loop
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
      conversation, question, answer, answer_citation, query_event to falcon_app;
  end if;
end $$;
