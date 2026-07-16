import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "redis";

describe("Redis Stream public contract", () => {
  it("is consumable using only the redis package, with no internal pipeline imports", async () => {
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    const meetingId = "contract-test-1";
    const streamKey = `meeting:${meetingId}:transcript`;
    await client.del(streamKey);

    await client.xAdd(streamKey, "*", {
      kind: "meeting_lifecycle",
      payload: JSON.stringify({
        type: "meeting_lifecycle",
        meetingId,
        status: "started",
        timestamp: 0,
        participants: [],
      }),
    });
    await client.xAdd(streamKey, "*", {
      kind: "transcript",
      payload: JSON.stringify({
        version: 1,
        utteranceId: "u1",
        meetingId,
        participantId: "p1",
        speakerName: "Alex",
        text: "hello",
        isFinal: true,
        startTs: 0,
        endTs: 500,
        confidence: 0.9,
        source: "deepgram",
        sequenceNumber: 1,
      }),
    });

    const entries = await client.xRange(streamKey, "-", "+");
    expect(entries).toHaveLength(2);
    expect(entries[0].message.kind).toBe("meeting_lifecycle");
    expect(entries[1].message.kind).toBe("transcript");
    const transcriptPayload = JSON.parse(entries[1].message.payload);
    expect(transcriptPayload.text).toBe("hello");
    expect(transcriptPayload.sequenceNumber).toBe(1);

    await client.quit();
  });
});
