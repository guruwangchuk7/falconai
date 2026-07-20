import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { EventEmitter } from "node:events";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { closeRedisClient, getRedisClient } from "../../src/redis/client";
import { LiveKitBotAdapter } from "../../src/livekit/liveKitBotAdapter";
import { wireTranscriptionPipeline } from "../../src/server/wireTranscriptionPipeline";
import { TranscriptPipeline } from "../../src/pipeline/transcriptPipeline";
import { PostgresTranscriptStore } from "../../src/pipeline/postgresTranscriptStore";
import { RedisTranscriptPublisher } from "../../src/pipeline/redisTranscriptPublisher";
import { SequenceNumberAllocator } from "../../src/pipeline/sequenceNumberAllocator";
import type {
  LiveKitRoomLike,
  LiveKitWebhookSource,
} from "../../src/livekit/liveKitBotAdapter.types";
import type { DeepgramLiveConnectionLike } from "../../src/transcription/deepgramLiveConnection.types";

// TranscriptionManager -> TranscriptPipeline delivery is fire-and-forget by design
// (onTranscriptEvent is typed `() => void`; production code never awaits it, since a
// transcript handler shouldn't block on network I/O). So this test can't know exactly
// when the resulting Postgres INSERT / Redis XADD has landed -- it must poll for the
// actual data rather than guess a fixed delay (see CLAUDE.md's testing gotcha section,
// and the same reasoning already applied in tests/integration/pipeline.integration.test.ts).
async function waitFor<T>(
  condition: () => Promise<T | undefined | null | false> | T | undefined | null | false,
  timeoutMs = 3000
): Promise<T> {
  const start = Date.now();
  while (true) {
    const result = await condition();
    if (result) return result as T;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("end-to-end LiveKit pipeline wiring", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
    await closeRedisClient();
  });

  it("carries a synthetic LiveKit meeting from room events to the Redis Stream and Postgres", async () => {
    const meetingId = "livekit-integration-test-1";

    const pool = getPool();
    await pool.query("DELETE FROM transcript_events WHERE meeting_id = $1", [meetingId]);
    await pool.query("DELETE FROM meetings WHERE meeting_id = $1", [meetingId]);
    const redisForCleanup = await getRedisClient();
    await redisForCleanup.del(`meeting:${meetingId}:transcript`);
    await redisForCleanup.del(`meeting:${meetingId}:seq`);

    const webhookEmitter = new EventEmitter();
    const webhookSource: LiveKitWebhookSource = {
      onRoomStarted: (cb) => webhookEmitter.on("roomStarted", cb),
      onRoomFinished: (cb) => webhookEmitter.on("roomFinished", cb),
      onParticipantJoined: (cb) => webhookEmitter.on("participantJoined", cb),
      onParticipantLeft: (cb) => webhookEmitter.on("participantLeft", cb),
    };

    let audioCallback: ((participantId: string, buffer: Buffer, timestamp: number) => void) | undefined;
    const fakeRoom: LiveKitRoomLike = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      onAudioData: (cb) => {
        audioCallback = cb;
      },
      onDisconnected: vi.fn(),
    };

    const liveKitBotAdapter = new LiveKitBotAdapter({
      webhookSource,
      createRoom: () => fakeRoom,
      url: "wss://example.livekit.cloud",
    });

    const pipeline = new TranscriptPipeline({
      store: new PostgresTranscriptStore(),
      publisher: new RedisTranscriptPublisher(),
      allocator: new SequenceNumberAllocator(),
      onAlert: (msg, err) => console.error(msg, err),
      postgresRetry: { retries: 1, baseDelayMs: 1 },
      redisRetry: { retries: 1, baseDelayMs: 1 },
    });

    let deepgramEmitter: EventEmitter | undefined;
    wireTranscriptionPipeline(liveKitBotAdapter, {
      pipeline,
      createSession: (): DeepgramLiveConnectionLike => {
        deepgramEmitter = new EventEmitter();
        return {
          onTranscript: (cb) => deepgramEmitter!.on("transcript", cb),
          onError: (cb) => deepgramEmitter!.on("error", cb),
          onClose: (cb) => deepgramEmitter!.on("close", cb),
          send: vi.fn(),
          finish: vi.fn(),
        };
      },
      inactivityTimeoutMs: 60_000,
    });

    webhookEmitter.emit("roomStarted", {
      meetingId,
      botToken: "bot-jwt",
      participants: [{ participantId: "p1", displayName: "Alex" }],
    });
    await new Promise((r) => setTimeout(r, 50));

    const audioTs = Date.now();
    audioCallback!("p1", Buffer.from([1, 2, 3]), audioTs);
    await new Promise((r) => setTimeout(r, 10));

    deepgramEmitter!.emit("transcript", {
      text: "hello from livekit integration test",
      isFinal: true,
      durationMs: 20,
      confidence: 0.9,
    });

    const rows = await waitFor(async () => {
      const { rows } = await pool.query(
        "SELECT text FROM transcript_events WHERE meeting_id = $1",
        [meetingId]
      );
      return rows.length > 0 ? rows : false;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("hello from livekit integration test");

    webhookEmitter.emit("roomFinished", { meetingId });

    const redis = await getRedisClient();
    const entries = await waitFor(async () => {
      const es = await redis.xRange(`meeting:${meetingId}:transcript`, "-", "+");
      return es.length >= 3 ? es : false;
    });
    const kinds = entries.map((e) => e.message.kind);
    expect(kinds).toEqual(["meeting_lifecycle", "transcript", "meeting_lifecycle"]);
  });
});
