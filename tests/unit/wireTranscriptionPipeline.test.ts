import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { wireTranscriptionPipeline } from "../../src/server/wireTranscriptionPipeline";
import type { MeetingSourceAdapter } from "../../src/server/wireTranscriptionPipeline";

class FakeAdapter extends EventEmitter implements MeetingSourceAdapter {}

describe("wireTranscriptionPipeline", () => {
  it("accepts any MeetingSourceAdapter, not just ZoomBotAdapter", async () => {
    const adapter = new FakeAdapter();
    const pipeline = {
      handleMeetingStarted: vi.fn().mockResolvedValue(undefined),
      handleMeetingEnded: vi.fn().mockResolvedValue(undefined),
      handleTranscriptEvent: vi.fn().mockResolvedValue(undefined),
    };

    wireTranscriptionPipeline(adapter, {
      pipeline: pipeline as any,
      createSession: () => ({
        onTranscript: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        send: vi.fn(),
        finish: vi.fn(),
      }),
    });

    adapter.emit("meetingStarted", "m1", [{ participantId: "p1", displayName: "Alex" }]);

    expect(pipeline.handleMeetingStarted).toHaveBeenCalledWith("m1", 0, [
      { participantId: "p1", displayName: "Alex" },
    ]);
  });
});
