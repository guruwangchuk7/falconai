// tests/unit/transcriptionManagerReconnect.test.ts
import { describe, it, expect, vi } from "vitest";
import { TranscriptionManager } from "../../src/transcription/transcriptionManager";
import type { DeepgramLiveConnectionLike } from "../../src/transcription/deepgramLiveConnection.types";

function makeFakeSession() {
  const handlers: Record<string, Function> = {};
  const send = vi.fn();
  const finish = vi.fn();
  const connection: DeepgramLiveConnectionLike = {
    onTranscript: (cb) => (handlers.transcript = cb),
    onError: (cb) => (handlers.error = cb),
    onClose: (cb) => (handlers.close = cb),
    send,
    finish,
  };
  return { connection, handlers, send, finish };
}

describe("TranscriptionManager reconnect", () => {
  it("buffers audio while reconnecting and flushes it to the new session in order", async () => {
    const first = makeFakeSession();
    const second = makeFakeSession();
    const createSession = vi
      .fn()
      .mockReturnValueOnce(first.connection)
      .mockReturnValueOnce(second.connection);

    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent: vi.fn(),
      now: () => 0,
      maxBufferedChunks: 10,
      reconnect: { retries: 1, baseDelayMs: 1 },
      sleep: async () => {},
    });

    manager.handleAudioChunk("p1", Buffer.from([1]), 100);
    first.handlers.close();
    manager.handleAudioChunk("p1", Buffer.from([2]), 150);

    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));

    expect(second.send).toHaveBeenCalledWith(Buffer.from([2]));
  });

  it("drops the oldest buffered chunk with a warning when the buffer overflows", async () => {
    const first = makeFakeSession();
    const second = makeFakeSession();
    const createSession = vi
      .fn()
      .mockReturnValueOnce(first.connection)
      .mockReturnValueOnce(second.connection);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent: vi.fn(),
      now: () => 0,
      maxBufferedChunks: 1,
      reconnect: { retries: 1, baseDelayMs: 1 },
      sleep: async () => {},
    });

    manager.handleAudioChunk("p1", Buffer.from([1]), 100);
    first.handlers.close();
    manager.handleAudioChunk("p1", Buffer.from([2]), 150);
    manager.handleAudioChunk("p1", Buffer.from([3]), 160);

    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));

    expect(second.send).toHaveBeenCalledWith(Buffer.from([3]));
    expect(second.send).not.toHaveBeenCalledWith(Buffer.from([2]));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("dropping buffered audio chunk")
    );
    warn.mockRestore();
  });

  it("does not start a second reconnect chain when both onError and onClose fire for the same failure", async () => {
    const first = makeFakeSession();
    const second = makeFakeSession();
    const createSession = vi
      .fn()
      .mockReturnValueOnce(first.connection)
      .mockReturnValueOnce(second.connection);

    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent: vi.fn(),
      now: () => 0,
      maxBufferedChunks: 10,
      reconnect: { retries: 1, baseDelayMs: 1 },
      sleep: async () => {},
    });

    manager.handleAudioChunk("p1", Buffer.from([1]), 100);

    // Simulate a WebSocket client firing both error and close for one failure,
    // synchronously back-to-back (the realistic ordering: error then close).
    first.handlers.error(new Error("boom"));
    first.handlers.close();

    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));

    // Give any (incorrect) second reconnect chain a chance to also create a session.
    await new Promise((r) => setTimeout(r, 10));

    // Only one reconnect should have happened: the original session plus exactly
    // one replacement, not two independent replacements racing each other.
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it("aborts a stale reconnect if the session is removed while sleeping, without resurrecting it", async () => {
    const first = makeFakeSession();
    const second = makeFakeSession();
    const createSession = vi
      .fn()
      .mockReturnValueOnce(first.connection)
      .mockReturnValueOnce(second.connection);

    let resolveSleep: () => void = () => {};
    const sleep = vi.fn(() => new Promise<void>((r) => (resolveSleep = r)));

    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent: vi.fn(),
      now: () => 0,
      maxBufferedChunks: 10,
      reconnect: { retries: 1, baseDelayMs: 1 },
      sleep,
    });

    manager.handleAudioChunk("p1", Buffer.from([1]), 100);
    first.handlers.close();

    // Reconnect is now sleeping (baseDelayMs * 2^0) before creating the replacement session.
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));

    // Participant leaves (or inactivity timeout fires) while the reconnect is mid-sleep,
    // removing the session's entry from the map entirely.
    manager.handleParticipantLeft("p1");
    expect(first.finish).toHaveBeenCalledTimes(1);

    // Now let the stale sleep resolve; the reconnect should notice the entry is gone
    // and abort instead of creating and stashing a new, unreferenced connection.
    resolveSleep();
    await new Promise((r) => setTimeout(r, 10));

    // The stale reconnect must not have called createSession again (no leaked connection,
    // and no assignment onto the removed entry).
    expect(createSession).toHaveBeenCalledTimes(1);

    // New audio for "p1" opens a genuinely fresh session, proving the stale reconnect
    // did not resurrect the old entry (which would have skipped this createSession call).
    manager.handleAudioChunk("p1", Buffer.from([9]), 200);
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(second.send).toHaveBeenCalledWith(Buffer.from([9]));
  });
});
