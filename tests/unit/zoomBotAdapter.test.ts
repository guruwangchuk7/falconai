import { describe, it, expect, vi } from "vitest";
import { ZoomBotAdapter } from "../../src/zoom/zoomBotAdapter";
import type {
  RtmsClientLike,
  ZoomWebhookSource,
} from "../../src/zoom/zoomBotAdapter.types";

function makeFakeWebhookSource() {
  const handlers: Record<string, Function> = {};
  const source: ZoomWebhookSource = {
    onRtmsStarted: (cb) => (handlers.started = cb),
    onRtmsStopped: (cb) => (handlers.stopped = cb),
    onParticipantJoined: (cb) => (handlers.joined = cb),
    onParticipantLeft: (cb) => (handlers.left = cb),
  };
  return { source, handlers };
}

function makeFakeClient() {
  const handlers: Record<string, Function> = {};
  const client: RtmsClientLike = {
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    setAudioParams: vi.fn(),
    onAudioData: (cb) => (handlers.audio = cb),
    onActiveSpeakerEvent: (cb) => (handlers.activeSpeaker = cb),
    onJoinConfirm: (cb) => (handlers.joinConfirm = cb),
    onLeave: (cb) => (handlers.leave = cb),
  };
  return { client, handlers };
}

describe("ZoomBotAdapter", () => {
  it("joins the RTMS client and emits meetingStarted when the webhook fires", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { client } = makeFakeClient();
    const adapter = new ZoomBotAdapter({
      webhookSource: source,
      createClient: () => client,
      audioParams: { mode: 1 },
      reconnect: { retries: 2, baseDelayMs: 1 },
    });

    const onStarted = vi.fn();
    adapter.on("meetingStarted", onStarted);

    await handlers.started({
      meetingId: "m1",
      joinPayload: { token: "abc" },
      participants: [{ participantId: "p1", displayName: "Alex" }],
    });

    expect(client.join).toHaveBeenCalledWith({ token: "abc" });
    expect(client.setAudioParams).toHaveBeenCalledWith({ mode: 1 });
    expect(onStarted).toHaveBeenCalledWith("m1", [
      { participantId: "p1", displayName: "Alex" },
    ]);
  });

  it("emits audioChunk with the participant id from RTMS metadata", async () => {
    const { source, handlers: webhookHandlers } = makeFakeWebhookSource();
    const { client, handlers: clientHandlers } = makeFakeClient();
    const adapter = new ZoomBotAdapter({
      webhookSource: source,
      createClient: () => client,
      audioParams: {},
      reconnect: { retries: 2, baseDelayMs: 1 },
    });

    const onAudioChunk = vi.fn();
    adapter.on("audioChunk", onAudioChunk);

    await webhookHandlers.started({
      meetingId: "m1",
      joinPayload: {},
      participants: [],
    });

    const buf = Buffer.from([1, 2, 3]);
    clientHandlers.audio(buf, 3, 5000, { userId: "p1", userName: "Alex" });

    expect(onAudioChunk).toHaveBeenCalledWith("p1", buf, 5000);
  });

  it("emits participantJoined/participantLeft from the webhook source", () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { client } = makeFakeClient();
    const adapter = new ZoomBotAdapter({
      webhookSource: source,
      createClient: () => client,
      audioParams: {},
      reconnect: { retries: 2, baseDelayMs: 1 },
    });

    const onJoined = vi.fn();
    const onLeft = vi.fn();
    adapter.on("participantJoined", onJoined);
    adapter.on("participantLeft", onLeft);

    handlers.joined({ meetingId: "m1", participant: { participantId: "p2", displayName: "Sam" } });
    handlers.left({ meetingId: "m1", participantId: "p2" });

    expect(onJoined).toHaveBeenCalledWith({ participantId: "p2", displayName: "Sam" });
    expect(onLeft).toHaveBeenCalledWith("p2");
  });

  it("emits a clean meetingEnded when the RTMS stream stops normally", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const { client } = makeFakeClient();
    const adapter = new ZoomBotAdapter({
      webhookSource: source,
      createClient: () => client,
      audioParams: {},
      reconnect: { retries: 2, baseDelayMs: 1 },
    });

    await handlers.started({ meetingId: "m1", joinPayload: {}, participants: [] });

    const onEnded = vi.fn();
    adapter.on("meetingEnded", onEnded);
    handlers.stopped({ meetingId: "m1" });

    expect(onEnded).toHaveBeenCalledWith("ended");
  });
});
