-- In-Meeting Decision Listener (feature 005 / post-meeting capture). Adds: the meeting object with an
-- attendee snapshot + retention marker; the durable working-copy transcript; attendee-gated decision
-- spans; the per-record visibility tier + participants; the per-workspace retention setting; and the
-- mine-once meeting ledger. See docs/superpowers/specs/2026-09-02-in-meeting-decision-listener-design.md.

-- 1) per-record visibility tier (D13) + participants snapshot (D12). Default 'workspace' so existing
--    behaviour is unchanged; 'attendees_only' gates the summary to the snapshotted attendee set.
alter table decision_record add column if not exists visibility text not null default 'workspace'
  check (visibility in ('workspace','attendees_only'));
alter table decision_record add column if not exists participants jsonb;

-- 2) per-workspace retention setting (D6). 0 = OFF (working copy discarded after extraction).
alter table workspace add column if not exists meeting_retention_days integer not null default 0;

-- 3) the meeting object. session_id ties back to the Phase-3 session; attendees is the immutable
--    snapshot (D12) [{ userId, displayName, isMember, isFalconUser }]; transcript_retained_until is
--    null when discarded (D6), so a reader knows whether "go read more" is possible.
create table if not exists meeting (
  id                        uuid not null default gen_random_uuid(),
  workspace_id              uuid not null,
  session_id                uuid not null,
  title                     text,
  started_at                timestamptz,
  ended_at                  timestamptz not null default now(),
  attendees                 jsonb not null,
  designated_reviewer_user_id uuid,
  transcript_retained_until timestamptz,
  created_at                timestamptz not null default now(),
  primary key (workspace_id, id)
);
alter table meeting enable row level security;
alter table meeting force row level security;
create policy meeting_tenant_isolation on meeting
  using (workspace_id = current_setting('app.workspace_id', true)::uuid)
  with check (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- 4) the durable working-copy transcript (D7). TRANSCRIPT TEXT ONLY, never audio (R6). One row per
--    meeting; expires_at is the short working-copy TTL, independent of the retention setting.
create table if not exists meeting_transcript (
  workspace_id  uuid not null,
  meeting_id    uuid not null,
  utterances    jsonb not null,   -- [{ idx, speaker, userId, text, tsMs }]
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, meeting_id)
);
alter table meeting_transcript enable row level security;
alter table meeting_transcript force row level security;
create policy meeting_transcript_tenant_isolation on meeting_transcript
  using (workspace_id = current_setting('app.workspace_id', true)::uuid)
  with check (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- 5) decision spans (D4/D9). The attendee-gated verbatim evidence: resolved text, not indices.
--    RLS here is TENANT-level only; attendee gating is enforced DB-side (primary enforcement) via the
--    RESTRICTIVE decision_span_attendee_read policy added in 0008, which relies on withViewer setting
--    app.user_id per request.
create table if not exists decision_span (
  id            uuid not null default gen_random_uuid(),
  workspace_id  uuid not null,
  decision_id   uuid not null,
  kind          text not null check (kind in ('decision','rationale')),
  speaker       text,
  ts_ms         bigint,
  utterance_idx integer,
  text          text not null,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists decision_span_decision_idx on decision_span (workspace_id, decision_id);
alter table decision_span enable row level security;
alter table decision_span force row level security;
create policy decision_span_tenant_isolation on decision_span
  using (workspace_id = current_setting('app.workspace_id', true)::uuid)
  with check (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- 6) mine-once meeting ledger (D7). No content_hash (unlike mined_artifact): a finalized transcript is
--    IMMUTABLE, so (workspace_id, meeting_id) + extractor_version fully identifies the work.
--    transcript_retained_until records whether a future re-mine is even possible (D6 ledger-honesty).
create table if not exists mined_meeting (
  workspace_id       uuid not null,
  meeting_id         uuid not null,
  mined_at           timestamptz not null default now(),
  result             text not null check (result in ('suggested','no_decision','error','deferred')),
  extractor_version  text not null,
  transcript_retained_until timestamptz,
  decision_id        uuid,
  max_candidate_score real,
  primary key (workspace_id, meeting_id)
);
alter table mined_meeting enable row level security;
alter table mined_meeting force row level security;
create policy mined_meeting_tenant_isolation on mined_meeting
  using (workspace_id = current_setting('app.workspace_id', true)::uuid)
  with check (workspace_id = current_setting('app.workspace_id', true)::uuid);
