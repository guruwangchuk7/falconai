import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { PostgresTranscriptStore } from "../../src/pipeline/postgresTranscriptStore";
import type { TranscriptEvent } from "../../src/types/transcriptEvent";

describe("PostgresTranscriptStore", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it("opens a meeting, saves a final event, and closes the meeting", async () => {
    const store = new PostgresTranscriptStore();
    await store.openMeeting("pg-store-test-1");

    const event: TranscriptEvent = {
      version: 1,
      utteranceId: "utt-1",
      meetingId: "pg-store-test-1",
      participantId: "p1",
      speakerName: "Alex",
      text: "hello",
      isFinal: true,
      startTs: 0,
      endTs: 500,
      confidence: 0.95,
      source: "deepgram",
      sequenceNumber: 1,
    };
    await store.saveFinalEvent(event);
    await store.closeMeeting("pg-store-test-1", "ended");

    const pool = getPool();
    const { rows: meetingRows } = await pool.query(
      "SELECT status FROM meetings WHERE meeting_id = $1",
      ["pg-store-test-1"]
    );
    expect(meetingRows[0].status).toBe("ended");

    const { rows: eventRows } = await pool.query(
      "SELECT text, sequence_number FROM transcript_events WHERE meeting_id = $1",
      ["pg-store-test-1"]
    );
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0].text).toBe("hello");
  });

  it("rejects interim (non-final) events", async () => {
    const store = new PostgresTranscriptStore();
    const interim: TranscriptEvent = {
      version: 1,
      utteranceId: "utt-2",
      meetingId: "pg-store-test-1",
      participantId: "p1",
      speakerName: "Alex",
      text: "hel",
      isFinal: false,
      startTs: 0,
      endTs: 200,
      confidence: 0.5,
      source: "deepgram",
      sequenceNumber: 2,
    };
    await expect(store.saveFinalEvent(interim)).rejects.toThrow(
      "PostgresTranscriptStore only persists final events"
    );
  });
});
