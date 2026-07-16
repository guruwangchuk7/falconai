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

  it("emits meetingEnded with ended_error after exhausting reconnect attempts", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    let joinCallCount = 0;
    const client: RtmsClientLike = {
      join: vi.fn(async () => {
        joinCallCount += 1;
        throw new Error("connect failed");
      }),
      leave: vi.fn(),
      setAudioParams: vi.fn(),
      onAudioData: vi.fn(),
      onActiveSpeakerEvent: vi.fn(),
      onJoinConfirm: vi.fn(),
      onLeave: vi.fn(),
    };
    const adapter = new ZoomBotAdapter({
      webhookSource: source,
      createClient: () => client,
      audioParams: {},
      reconnect: { retries: 2, baseDelayMs: 1 },
    });

    const onEnded = vi.fn();
    adapter.on("meetingEnded", onEnded);

    await handlers.started({ meetingId: "m1", joinPayload: {}, participants: [] });

    expect(joinCallCount).toBe(3); // initial attempt + 2 retries
    expect(onEnded).toHaveBeenCalledWith("ended_error");
  });

  it("resets the reconnect budget after a healthy reconnection", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    const clientHandlers: Record<string, Function> = {};
    let joinShouldFail = false;
    let joinCallCount = 0;
    const client: RtmsClientLike = {
      join: vi.fn(async () => {
        joinCallCount += 1;
        if (joinShouldFail) throw new Error("connect failed");
      }),
      leave: vi.fn(),
      setAudioParams: vi.fn(),
      onAudioData: vi.fn(),
      onActiveSpeakerEvent: vi.fn(),
      onJoinConfirm: vi.fn(),
      onLeave: (cb) => (clientHandlers.leave = cb),
    };
    const adapter = new ZoomBotAdapter({
      webhookSource: source,
      createClient: () => client,
      audioParams: {},
      reconnect: { retries: 2, baseDelayMs: 1 },
      sleep: async () => {},
    });

    const onStarted = vi.fn();
    const onEnded = vi.fn();
    adapter.on("meetingStarted", onStarted);
    adapter.on("meetingEnded", onEnded);

    // Initial successful join.
    await handlers.started({ meetingId: "m1", joinPayload: {}, participants: [] });
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(joinCallCount).toBe(1);

    // Unexpected (non-normal) leave after a healthy period -> exactly one reconnect,
    // which succeeds again. This success must reset the attempt counter to 0.
    clientHandlers.leave(1);
    await vi.waitFor(() => expect(joinCallCount).toBe(2));
    expect(onEnded).not.toHaveBeenCalled();

    // Now the connection drops again and every reconnect fails. Because the counter
    // reset after the healthy reconnection, exhaustion must take the FULL budget
    // again: 2 failing join attempts (retries=2) before ended_error -- not a reduced
    // budget carried over from before the healthy period (which would give up after 1).
    joinShouldFail = true;
    clientHandlers.leave(1);

    await vi.waitFor(() => expect(onEnded).toHaveBeenCalledWith("ended_error"));
    // 1 (initial) + 1 (healthy reconnect) + 2 (full failing budget) = 4.
    expect(joinCallCount).toBe(4);
  });

  it("does not emit meetingStarted when the initial connection exhausts all retries", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    let joinCallCount = 0;
    const client: RtmsClientLike = {
      join: vi.fn(async () => {
        joinCallCount += 1;
        throw new Error("connect failed");
      }),
      leave: vi.fn(),
      setAudioParams: vi.fn(),
      onAudioData: vi.fn(),
      onActiveSpeakerEvent: vi.fn(),
      onJoinConfirm: vi.fn(),
      onLeave: vi.fn(),
    };
    const adapter = new ZoomBotAdapter({
      webhookSource: source,
      createClient: () => client,
      audioParams: {},
      reconnect: { retries: 2, baseDelayMs: 1 },
    });

    const onEnded = vi.fn();
    const onStarted = vi.fn();
    adapter.on("meetingEnded", onEnded);
    adapter.on("meetingStarted", onStarted);

    await handlers.started({ meetingId: "m1", joinPayload: {}, participants: [] });

    expect(joinCallCount).toBe(3); // initial attempt + 2 retries
    expect(onEnded).toHaveBeenCalledWith("ended_error");
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("gives a fresh full retry budget to a new meeting even after the previous meeting exhausted its retries", async () => {
    const { source, handlers } = makeFakeWebhookSource();
    let joinCallCount = 0;
    let joinShouldFail = true;
    const client: RtmsClientLike = {
      join: vi.fn(async () => {
        joinCallCount += 1;
        if (joinShouldFail) throw new Error("connect failed");
      }),
      leave: vi.fn(),
      setAudioParams: vi.fn(),
      onAudioData: vi.fn(),
      onActiveSpeakerEvent: vi.fn(),
      onJoinConfirm: vi.fn(),
      onLeave: vi.fn(),
    };
    const adapter = new ZoomBotAdapter({
      webhookSource: source,
      createClient: () => client,
      audioParams: {},
      reconnect: { retries: 2, baseDelayMs: 1 },
    });

    const onEnded = vi.fn();
    adapter.on("meetingEnded", onEnded);

    // First meeting: every join attempt fails, exhausting the full retry budget and
    // leaving reconnectAttempt at its max (this is the state that used to leak into
    // the next meeting before the fix).
    await handlers.started({ meetingId: "m1", joinPayload: {}, participants: [] });
    expect(joinCallCount).toBe(3); // initial attempt + 2 retries
    expect(onEnded).toHaveBeenCalledWith("ended_error");

    // Second meeting: join fails just as many times as the retry budget allows. If
    // reconnectAttempt were not reset, this would immediately hit ended_error with
    // zero retries (joinCallCount would stay at 3 + 1 = 4). With the fix, the new
    // meeting gets a full fresh budget: initial attempt + 2 retries = 3 more calls.
    joinCallCount = 0;
    onEnded.mockClear();
    await handlers.started({ meetingId: "m2", joinPayload: {}, participants: [] });

    expect(joinCallCount).toBe(3); // initial attempt + 2 retries, full budget again
    expect(onEnded).toHaveBeenCalledWith("ended_error");
  });
});
