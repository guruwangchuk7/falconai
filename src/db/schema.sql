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
