-- One meeting per session (in-meeting listener, D7 robustness). Backstops the assembly idempotency
-- guard against a concurrent double-trigger / failover creating two meetings for one session.
create unique index if not exists meeting_workspace_session_uniq on meeting (workspace_id, session_id);
