-- setup-app-role.sql — create the runtime application role `falcon_app`.
--
-- WHY: the app must connect as a NON-superuser, NON-BYPASSRLS role or Postgres RLS is silently
-- bypassed (superusers and BYPASSRLS roles ignore RLS even under FORCE ROW LEVEL SECURITY),
-- defeating tenant isolation (PRD R25 / SC-003). Migrations run as the owner (DATABASE_URL);
-- the app runtime connects as this role (APP_DATABASE_URL).
--
-- RUN AS: the database owner (e.g. Supabase `postgres`), AFTER 0001_init.sql.
--   psql "$DATABASE_URL" -v pw="$(openssl rand -base64 24 | tr -dc A-Za-z0-9 | head -c 28)" -f setup-app-role.sql
-- Then set APP_DATABASE_URL. On Supabase's pooler the username is `falcon_app.<project-ref>`:
--   APP_DATABASE_URL=postgresql://falcon_app.<project-ref>:<pw>@<host>:6543/postgres
--
-- NOTE: `create role ... login` (no SUPERUSER/BYPASSRLS clauses) already yields a safe role;
-- explicitly setting NOSUPERUSER/NOBYPASSRLS requires a true superuser, which managed Postgres
-- (Supabase) does not grant. The defaults are correct, so we don't set them.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'falcon_app') then
    create role falcon_app login;
  end if;
end $$;

-- Password passed via psql -v pw=... ; quote_literal keeps it injection-safe.
select format('alter role falcon_app login password %L', :'pw') \gexec

grant usage on schema public to falcon_app;
grant select, insert, update, delete on all tables in schema public to falcon_app;
grant usage, select on all sequences in schema public to falcon_app;

-- Future tables (new partitions, new tables from later migrations) inherit the grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables to falcon_app;
alter default privileges in schema public
  grant usage, select on sequences to falcon_app;

-- Sanity: falcon_app must NOT bypass RLS.
do $$
declare bypass boolean;
begin
  select rolbypassrls into bypass from pg_roles where rolname = 'falcon_app';
  if bypass then
    raise exception 'falcon_app has BYPASSRLS — RLS would be bypassed; refuse to proceed';
  end if;
end $$;
