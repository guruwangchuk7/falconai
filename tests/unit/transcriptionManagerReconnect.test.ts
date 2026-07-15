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
});
