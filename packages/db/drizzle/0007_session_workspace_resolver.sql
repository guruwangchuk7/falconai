-- session->workspace bootstrap resolver (in-meeting listener, B3). The session-worker must learn a
-- session's workspace to set its tenant context, but `session` is FORCE-RLS'd (0003) and the worker
-- has no context yet -- the one lookup that structurally cannot carry a tenant predicate. SECURITY
-- DEFINER runs as the function owner (the migration role) and returns ONLY the scalar workspace_id
-- for a session_id the caller already holds: no content, no enumeration. plpgsql (not sql) so the
-- body is resolved at call time, letting the function be created before `session` exists (test base
-- applies 0007 ahead of 0003). Default PUBLIC EXECUTE is intentional (only DB principal is falcon_app;
-- an explicit grant would fail because startTestDb creates falcon_app AFTER migrations run).
create or replace function resolve_session_workspace(p_session uuid) returns uuid
  language plpgsql security definer stable
  set search_path = pg_catalog, public as $$
begin
  return (select workspace_id from public.session where id = p_session);
end $$;
