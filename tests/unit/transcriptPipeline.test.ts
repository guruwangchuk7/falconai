import { describe, it, expect, vi } from "vitest";
import { TranscriptPipeline } from "../../src/pipeline/transcriptPipeline";

function makeDeps(overrides: Partial<Parameters<typeof TranscriptPipeline.prototype.constructor>[0]> = {}) {
  return {
    store: {
      openMeeting: vi.fn().mockResolvedValue(undefined),
      closeMeeting: vi.fn().mockResolvedValue(undefined),
      saveFinalEvent: vi.fn().mockResolvedValue(undefined),
    },
    publisher: {
      publishTranscript: vi.fn().mockResolvedValue(undefined),
      publishLifecycle: vi.fn().mockResolvedValue(undefined),
    },
    allocator: { next: vi.fn().mockResolvedValue(1) },
    onAlert: vi.fn(),
    postgresRetry: { retries: 2, baseDelayMs: 1 },
    redisRetry: { retries: 2, baseDelayMs: 1 },
    ...overrides,
  };
}

describe("TranscriptPipeline", () => {
  it("opens the meeting then publishes a started lifecycle event", async () => {
    const deps = makeDeps();
    const pipeline = new TranscriptPipeline(deps as any);

    await pipeline.handleMeetingStarted("m1", 1000, [
      { participantId: "p1", displayName: "Alex" },
    ]);

    expect(deps.store.openMeeting).toHaveBeenCalledWith("m1");
    expect(deps.publisher.publishLifecycle).toHaveBeenCalledWith({
      type: "meeting_lifecycle",
      meetingId: "m1",
      status: "started",
      timestamp: 1000,
      participants: [{ participantId: "p1", displayName: "Alex" }],
    });
  });

  it("assigns a sequence number, persists final events, and always publishes", async () => {
    const deps = makeDeps();
    const pipeline = new TranscriptPipeline(deps as any);

    await pipeline.handleTranscriptEvent({
      version: 1,
      utteranceId: "u1",
      meetingId: "m1",
      participantId: "p1",
      speakerName: "Alex",
      text: "hi",
      isFinal: true,
      startTs: 0,
      endTs: 100,
      confidence: 0.9,
      source: "deepgram",
    });

    expect(deps.store.saveFinalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sequenceNumber: 1 })
    );
    expect(deps.publisher.publishTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ sequenceNumber: 1 })
    );
  });

  it("does not persist interim events but still publishes them", async () => {
    const deps = makeDeps();
    const pipeline = new TranscriptPipeline(deps as any);

    await pipeline.handleTranscriptEvent({
      version: 1,
      utteranceId: "u1",
      meetingId: "m1",
      participantId: "p1",
      speakerName: "Alex",
      text: "h",
      isFinal: false,
      startTs: 0,
      endTs: 50,
      confidence: 0.4,
      source: "deepgram",
    });

    expect(deps.store.saveFinalEvent).not.toHaveBeenCalled();
    expect(deps.publisher.publishTranscript).toHaveBeenCalled();
  });

  it("alerts but keeps delivering live when Postgres persistence fails", async () => {
    const deps = makeDeps({
      store: {
        openMeeting: vi.fn().mockResolvedValue(undefined),
        closeMeeting: vi.fn().mockResolvedValue(undefined),
        saveFinalEvent: vi.fn().mockRejectedValue(new Error("db down")),
      },
    });
    const pipeline = new TranscriptPipeline(deps as any);

    await pipeline.handleTranscriptEvent({
      version: 1,
      utteranceId: "u1",
      meetingId: "m1",
      participantId: "p1",
      speakerName: "Alex",
      text: "hi",
      isFinal: true,
      startTs: 0,
      endTs: 100,
      confidence: 0.9,
      source: "deepgram",
    });

    expect(deps.onAlert).toHaveBeenCalledWith(
      expect.stringContaining("postgres persistence failed"),
      expect.any(Error)
    );
    expect(deps.publisher.publishTranscript).toHaveBeenCalled();
  });

  it("alerts and rethrows when Redis publishing fails after retries", async () => {
    const deps = makeDeps({
      publisher: {
        publishTranscript: vi.fn().mockRejectedValue(new Error("redis down")),
        publishLifecycle: vi.fn().mockResolvedValue(undefined),
      },
    });
    const pipeline = new TranscriptPipeline(deps as any);

    await expect(
      pipeline.handleTranscriptEvent({
        version: 1,
        utteranceId: "u1",
        meetingId: "m1",
        participantId: "p1",
        speakerName: "Alex",
        text: "hi",
        isFinal: true,
        startTs: 0,
        endTs: 100,
        confidence: 0.9,
        source: "deepgram",
      })
    ).rejects.toThrow("redis down");

    expect(deps.onAlert).toHaveBeenCalledWith(
      expect.stringContaining("redis publish failed"),
      expect.any(Error)
    );
  });
});
