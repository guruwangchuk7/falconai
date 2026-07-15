import { describe, it, expect, vi } from "vitest";
import { SttSession } from "../../src/transcription/sttSession";
import type { DeepgramLiveConnectionLike } from "../../src/transcription/deepgramLiveConnection.types";

function makeFakeConnection() {
  const handlers: Record<string, Function> = {};
  const connection: DeepgramLiveConnectionLike = {
    onTranscript: (cb) => (handlers.transcript = cb),
    onError: (cb) => (handlers.error = cb),
    onClose: (cb) => (handlers.close = cb),
    send: vi.fn(),
    finish: vi.fn(),
  };
  return { connection, handlers };
}

describe("SttSession", () => {
  it("forwards transcript, error, and close events to the provided handlers", () => {
    const { connection, handlers } = makeFakeConnection();
    const onResult = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();

    SttSession.start(connection, { onResult, onError, onClose });

    const payload = {
      text: "hello",
      isFinal: true,
      durationMs: 500,
      confidence: 0.9,
    };
    handlers.transcript(payload);
    expect(onResult).toHaveBeenCalledWith(payload);

    const err = new Error("boom");
    handlers.error(err);
    expect(onError).toHaveBeenCalledWith(err);

    handlers.close();
    expect(onClose).toHaveBeenCalled();
  });

  it("sends audio buffers and closes the underlying connection", () => {
    const { connection } = makeFakeConnection();
    const session = SttSession.start(connection, {
      onResult: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    });

    const buf = Buffer.from([1, 2, 3]);
    session.send(buf);
    expect(connection.send).toHaveBeenCalledWith(buf);

    session.close();
    expect(connection.finish).toHaveBeenCalled();
  });
});
