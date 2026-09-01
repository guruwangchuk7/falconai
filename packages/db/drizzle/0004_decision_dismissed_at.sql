-- Feature 005 (Decision Memory) — dismiss support.
--
-- Dismiss is modeled as a nullable timestamp, ORTHOGONAL to the status lifecycle
-- (unconfirmed/confirmed/superseded), NOT as a 4th status value. Rationale (research.md R6):
-- decision_record is HASH-PARTITIONED (16 partitions) and `status` carries a raw CHECK constraint;
-- adding an enum value would require constraint surgery across the parent + every partition. An
-- ADD COLUMN on the partitioned parent cascades cleanly and also gives us an audit timestamp.
--
-- A dismissed candidate: never grounds (already excluded — searchDecisions filters status='confirmed'),
-- never surfaces as answer status metadata (matchUnconfirmedCandidates filters dismissed_at is null),
-- and is a persistent tombstone so the Ship-2 miner won't re-suggest the same source item.

alter table decision_record add column if not exists dismissed_at timestamptz;

-- Supports the unconfirmed-queue and match filters (status='unconfirmed' and dismissed_at is null).
create index if not exists decision_dismissed_idx on decision_record (workspace_id) where dismissed_at is not null;
