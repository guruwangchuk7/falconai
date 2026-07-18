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

  it("emits participantJoined/participantLeft from the webhook source", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { room } = makeFakeRoom();
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    await handlers.roomStarted({
      meetingId: "falcon-meet",
      botToken: "bot-jwt",
      participants: [],
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

  it("ignores participantJoined/participantLeft webhooks for a meeting that isn't currently active", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { room } = makeFakeRoom();
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    await handlers.roomStarted({
      meetingId: "current-meeting",
      botToken: "bot-jwt",
      participants: [],
    });

    const onJoined = vi.fn();
    const onLeft = vi.fn();
    adapter.on("participantJoined", onJoined);
    adapter.on("participantLeft", onLeft);

    // Late-arriving webhook events for a stale/different meeting must be ignored.
    handlers.participantJoined({
      meetingId: "stale-meeting",
      participant: { participantId: "sam", displayName: "Sam" },
    });
    handlers.participantLeft({ meetingId: "stale-meeting", participantId: "sam" });

    expect(onJoined).not.toHaveBeenCalled();
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("emits meetingEnded(ended_error) instead of meetingStarted when room.connect() rejects", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { room } = makeFakeRoom();
    (room.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connect failed"));
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    const onStarted = vi.fn();
    const onEnded = vi.fn();
    adapter.on("meetingStarted", onStarted);
    adapter.on("meetingEnded", onEnded);

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      handlers.roomStarted({
        meetingId: "falcon-meet",
        botToken: "bot-jwt",
        participants: [{ participantId: "alex", displayName: "Alex" }],
      })
    ).resolves.toBeUndefined();

    expect(onStarted).not.toHaveBeenCalled();
    expect(onEnded).toHaveBeenCalledWith("ended_error");
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("still emits meetingEnded(ended) when room.disconnect() rejects during handleRoomFinished", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { room } = makeFakeRoom();
    (room.disconnect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("disconnect failed"));
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    await handlers.roomStarted({
      meetingId: "falcon-meet",
      botToken: "bot-jwt",
      participants: [],
    });

    const onEnded = vi.fn();
    adapter.on("meetingEnded", onEnded);

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    handlers.roomFinished({ meetingId: "falcon-meet" });

    expect(onEnded).toHaveBeenCalledWith("ended");

    // Let the rejected disconnect() promise's .catch() handler run before asserting
    // no unhandled rejection occurred.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("emits a clean meetingEnded when the room-finished webhook fires", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { room } = makeFakeRoom();
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    await handlers.roomStarted({ meetingId: "falcon-meet", botToken: "bot-jwt", participants: [] });

    const onEnded = vi.fn();
    adapter.on("meetingEnded", onEnded);
    handlers.roomFinished({ meetingId: "falcon-meet" });

    expect(room.disconnect).toHaveBeenCalled();
    expect(onEnded).toHaveBeenCalledWith("ended");
  });

  it("emits meetingEnded with ended_error when the room disconnects unexpectedly", async () => {
    const { source, handlers: webhookHandlers } = makeFakeWebhookSource();
    const { room, handlers: roomHandlers } = makeFakeRoom();
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    await webhookHandlers.roomStarted({
      meetingId: "falcon-meet",
      botToken: "bot-jwt",
      participants: [],
    });

    const onEnded = vi.fn();
    adapter.on("meetingEnded", onEnded);
    roomHandlers.disconnected("SIGNAL_CLOSE");

    expect(onEnded).toHaveBeenCalledWith("ended_error");
  });

  it("ignores a room-finished webhook for a different meeting", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { room } = makeFakeRoom();
    const adapter = new LiveKitBotAdapter({
      webhookSource: source,
      createRoom: () => room,
      url: "wss://example.livekit.cloud",
    });

    await handlers.roomStarted({ meetingId: "falcon-meet", botToken: "bot-jwt", participants: [] });

    const onEnded = vi.fn();
    adapter.on("meetingEnded", onEnded);
    handlers.roomFinished({ meetingId: "some-other-room" });

    expect(onEnded).not.toHaveBeenCalled();
    expect(room.disconnect).not.toHaveBeenCalled();
  });
});
