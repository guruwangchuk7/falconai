import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { TranscriptFetcher } from "../../src/knowledgeGraph/transcriptFetcher";

describe("TranscriptFetcher", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it("reads a meeting's transcript_events ordered by sequence_number and formats them", async () => {
    const pool = getPool();
    const meetingId = "transcript-fetcher-test-1";
    await pool.query(
      `INSERT INTO meetings (meeting_id, started_at, status) VALUES ($1, now(), 'ended')
       ON CONFLICT (meeting_id) DO NOTHING`,
      [meetingId]
    );
    await pool.query(`DELETE FROM transcript_events WHERE meeting_id = $1`, [meetingId]);
    await pool.query(
      `INSERT INTO transcript_events
        (meeting_id, utterance_id, participant_id, speaker_name, text, start_ts, end_ts, confidence, source, sequence_number)
       VALUES
        ($1, 'u2', 'p2', 'Sam', 'Agreed.', 500, 700, 0.9, 'deepgram', 2),
        ($1, 'u1', 'p1', 'Alex', 'Let''s use Postgres.', 0, 400, 0.95, 'deepgram', 1)`,
      [meetingId]
    );

    const fetcher = new TranscriptFetcher();
    const result = await fetcher.fetchFormattedTranscript(meetingId);

    expect(result.promptText).toBe(
      "[0] Alex: Let's use Postgres.\n[500] Sam: Agreed."
    );
    expect(result.participants).toEqual([
      { participantId: "p1", speakerName: "Alex" },
      { participantId: "p2", speakerName: "Sam" },
    ]);
  });

  it("returns empty output for a meeting with no transcript events", async () => {
    const pool = getPool();
    const meetingId = "transcript-fetcher-test-empty";
    await pool.query(
      `INSERT INTO meetings (meeting_id, started_at, status) VALUES ($1, now(), 'ended')
       ON CONFLICT (meeting_id) DO NOTHING`,
      [meetingId]
    );

    const fetcher = new TranscriptFetcher();
    const result = await fetcher.fetchFormattedTranscript(meetingId);

    expect(result).toEqual({ promptText: "", participants: [] });
  });
});
