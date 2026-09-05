-- Commitment tracking (showcase feature). A commitment is a promise/action item a person makes in a
-- meeting or call — "I'll send the revised mockups by Friday", "we'll add SSO next sprint". It is the
-- freelancer's killer query surface: "what did I promise Acme that isn't done yet?".
--
-- Isolated from the decision path on purpose (same discipline as feature 005 isolating the meeting
-- extractor from the PR miner): commitments are a SEPARATE, lightweight overlay written by a guarded,
-- error-contained pass in handleMeetingExtract — a commitment-extraction failure must never regress the
-- proven decision extraction. Provenance (F7.2): every commitment carries the verbatim evidence line and
-- source_ref = meeting:{id}; owner/counterparty/due are best-effort metadata the model reads off the
-- transcript, NEVER the model's own authority. Text only, no audio (R6).

create table if not exists commitment (
  id             uuid not null default gen_random_uuid(),
  workspace_id   uuid not null,
  text           text not null,                                  -- the promise itself ("send revised mockups")
  owner_hint     text,                                           -- who promised (free label from the transcript)
  counterparty   text,                                           -- who it was promised TO ("Acme"), when stated
  due_hint       text,                                           -- when, in the speaker's words ("by Friday"), if any
  status         text not null default 'open' check (status in ('open','done')),
  source_ref     text,                                           -- provenance: meeting:{meetingId}, never model output
  meeting_id     uuid,                                           -- the originating meeting (nullable; no FK, mirrors decision spans)
  evidence_speaker text,                                         -- the receipt: who said it
  evidence_text  text not null,                                  -- the receipt: the verbatim line the promise came from
  evidence_utterance_idx integer,                                -- index into the transcript for ordering/citation
  created_at     timestamptz not null default now(),
  done_at        timestamptz,                                    -- when marked done (null while open)
  primary key (workspace_id, id)
);
create index if not exists commitment_workspace_status_idx on commitment (workspace_id, status);

-- Tenant isolation (R25/SC-003): identical policy to every other tenant table. falcon_app inherits the
-- table grants via ALTER DEFAULT PRIVILEGES (setup-app-role.sql), so no explicit grant is needed here.
alter table commitment enable row level security;
alter table commitment force row level security;
create policy commitment_tenant_isolation on commitment
  using (workspace_id = current_setting('app.workspace_id', true)::uuid)
  with check (workspace_id = current_setting('app.workspace_id', true)::uuid);
