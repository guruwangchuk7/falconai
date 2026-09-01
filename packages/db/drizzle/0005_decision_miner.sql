-- Ship 2 (Decision Miner). Adds: PR/issue outcome state on artifact; origin on decision_record;
-- the mined_artifact idempotency ledger; and a connect-time watermark on connection so first-sync
-- backfill does not blow up cost. See docs/superpowers/specs/2026-09-01-ship2-decision-miner-design.md.

-- 1) artifact outcome state (adapters populate; miner gates on merged/completed).
alter table artifact add column if not exists state text;                 -- merged|closed|open|completed|canceled|...
alter table artifact add column if not exists merged_closed_at timestamptz;

-- 2) provenance origin on decision records (queue badges "Suggested from …" off this).
alter table decision_record add column if not exists origin text not null default 'manual';

-- 3) connect-time watermark. DEFAULT now() sets it at connect for new rows (no route edits);
--    backfill existing rows so the historical-mining blowup cannot fire on current/pilot connections.
alter table connection add column if not exists mine_watermark timestamptz not null default now();
update connection set mine_watermark = now() where mine_watermark is null;

-- 4) mine-once ledger. Not partitioned (low volume, one row per mined artifact).
create table if not exists mined_artifact (
  workspace_id       uuid not null,
  artifact_id        uuid not null,
  mined_at           timestamptz not null default now(),
  result             text not null check (result in ('suggested','no_decision','error','deferred')),
  extractor_version  text not null,
  content_hash       text not null,
  decision_id        uuid,
  max_candidate_score real,
  primary key (workspace_id, artifact_id)
);

alter table mined_artifact enable row level security;
alter table mined_artifact force row level security;
create policy mined_artifact_tenant_isolation on mined_artifact
  using (workspace_id = current_setting('app.workspace_id', true)::uuid)
  with check (workspace_id = current_setting('app.workspace_id', true)::uuid);
