import type {
  DeepgramLiveConnectionLike,
  DeepgramTranscriptPayload,
} from "./deepgramLiveConnection.types";

export interface SttSessionHandlers {
  onResult: (payload: DeepgramTranscriptPayload) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

export class SttSession {
  private constructor(private readonly connection: DeepgramLiveConnectionLike) {}

  static start(
    connection: DeepgramLiveConnectionLike,
    handlers: SttSessionHandlers
  ): SttSession {
    connection.onTranscript(handlers.onResult);
    connection.onError(handlers.onError);
    connection.onClose(handlers.onClose);
    return new SttSession(connection);
  }

  send(buffer: Buffer): void {
    this.connection.send(buffer);
  }

  close(): void {
    this.connection.finish();
  }
}
