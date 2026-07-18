import { describe, it, expect, vi } from "vitest";
import { LiveKitBotAdapter } from "../../src/livekit/liveKitBotAdapter";
import type {
  LiveKitRoomLike,
  LiveKitWebhookSource,
} from "../../src/livekit/liveKitBotAdapter.types";

function makeFakeWebhookSource() {
  const handlers: Record<string, Function> = {};
  const source: LiveKitWebhookSource = {
    onRoomStarted: (cb) => (handlers.roomStarted = cb),
    onRoomFinished: (cb) => (handlers.roomFinished = cb),
    onParticipantJoined: (cb) => (handlers.participantJoined = cb),
    onParticipantLeft: (cb) => (handlers.participantLeft = cb),
  };
  return { source, handlers };
}

function makeFakeRoom() {
  const handlers: Record<string, Function> = {};
  const room: LiveKitRoomLike = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onAudioData: (cb) => (handlers.audio = cb),
    onDisconnected: (cb) => (handlers.disconnected = cb),
  };
  return { room, handlers };
}

describe("LiveKitBotAdapter", () => {
  it("joins the room and emits meetingStarted when the room-started webhook fires", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { room } = makeFakeRoom();
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    const onStarted = vi.fn();
    adapter.on("meetingStarted", onStarted);

    await handlers.roomStarted({
      meetingId: "falcon-meet",
      botToken: "bot-jwt",
      participants: [{ participantId: "alex", displayName: "Alex" }],
    });

    expect(room.connect).toHaveBeenCalledWith("wss://example.livekit.cloud", "bot-jwt");
    expect(onStarted).toHaveBeenCalledWith("falcon-meet", [
      { participantId: "alex", displayName: "Alex" },
    ]);
  });

  it("emits audioChunk with the participant id from the room-like audio callback", async () => {
    const { source, handlers: webhookHandlers } = makeFakeWebhookSource();
    const { room, handlers: roomHandlers } = makeFakeRoom();
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    const onAudioChunk = vi.fn();
    adapter.on("audioChunk", onAudioChunk);

    await webhookHandlers.roomStarted({
      meetingId: "falcon-meet",
      botToken: "bot-jwt",
      participants: [],
    });

    const buf = Buffer.from([1, 2, 3]);
    roomHandlers.audio("alex", buf, 5000);

    expect(onAudioChunk).toHaveBeenCalledWith("alex", buf, 5000);
  });

  it("emits participantJoined/participantLeft from the webhook source", () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { room } = makeFakeRoom();
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    const onJoined = vi.fn();
    const onLeft = vi.fn();
    adapter.on("participantJoined", onJoined);
    adapter.on("participantLeft", onLeft);

    handlers.participantJoined({
      meetingId: "falcon-meet",
      participant: { participantId: "sam", displayName: "Sam" },
    });
    handlers.participantLeft({ meetingId: "falcon-meet", participantId: "sam" });

    expect(onJoined).toHaveBeenCalledWith({ participantId: "sam", displayName: "Sam" });
    expect(onLeft).toHaveBeenCalledWith("sam");
  });
});
