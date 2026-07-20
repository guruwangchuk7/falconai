CREATE TABLE IF NOT EXISTS meetings (
  meeting_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS transcript_events (
  id BIGSERIAL PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(meeting_id),
  utterance_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  speaker_name TEXT NOT NULL,
  text TEXT NOT NULL,
  start_ts BIGINT NOT NULL,
  end_ts BIGINT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  sequence_number BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_transcript_events_meeting
  ON transcript_events (meeting_id, sequence_number);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS graph_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  natural_key TEXT,
  label TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_nodes_type_natural_key
  ON graph_nodes (type, natural_key) WHERE natural_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_node_id, to_node_id, type)
);

CREATE TABLE IF NOT EXISTS graph_builds (
  meeting_id TEXT PRIMARY KEY REFERENCES meetings(meeting_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- CREATE TABLE IF NOT EXISTS above only applies ON DELETE CASCADE to a freshly
-- created table; re-run migrate() against a database where graph_builds already
-- exists (e.g. this dev machine) leaves the original no-cascade FK in place, so
-- deleting a meetings row that already has a graph_builds row throws a foreign
-- key violation instead of cascading. Make the cascade idempotent to add too.
ALTER TABLE graph_builds DROP CONSTRAINT IF EXISTS graph_builds_meeting_id_fkey;
ALTER TABLE graph_builds
  ADD CONSTRAINT graph_builds_meeting_id_fkey
  FOREIGN KEY (meeting_id) REFERENCES meetings(meeting_id) ON DELETE CASCADE;
