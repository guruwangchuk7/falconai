import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import { RedisTranscriptPublisher } from "../../src/pipeline/redisTranscriptPublisher";
import { closeRedisClient, getRedisClient } from "../../src/redis/client";
import type { TranscriptEvent } from "../../src/types/transcriptEvent";

describe("RedisTranscriptPublisher", () => {
  afterAll(async () => {
    await closeRedisClient();
  });

  it("publishes a transcript event onto the meeting's stream", async () => {
    const client = await getRedisClient();
    await client.del("meeting:pub-test-1:transcript");

    const publisher = new RedisTranscriptPublisher();
    const event: TranscriptEvent = {
      version: 1,
      utteranceId: "utt-1",
      meetingId: "pub-test-1",
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
    await publisher.publishTranscript(event);

    const entries = await client.xRange("meeting:pub-test-1:transcript", "-", "+");
    expect(entries).toHaveLength(1);
    expect(entries[0].message.kind).toBe("transcript");
    expect(JSON.parse(entries[0].message.payload)).toEqual(event);
  });
});
