import { DeepgramClient } from "@deepgram/sdk";
import type {
  DeepgramLiveConnectionLike,
  DeepgramTranscriptPayload,
} from "./deepgramLiveConnection.types";

/**
 * Creates a Deepgram live transcription session using the real-time
 * `listen.v1` streaming API (not `v2`, which does not support `diarize`).
 *
 * This factory is intentionally synchronous even though the underlying SDK's
 * `v1.connect(...)` call is async: callers (see Task 10's plan) register
 * `onTranscript`/`onError`/`onClose` handlers and call `send`/`finish`
 * immediately on the returned object, before the websocket has necessarily
 * finished connecting. To support that, callbacks are collected into local
 * arrays synchronously, and any `send`/`finish` calls made before the
 * underlying socket is ready are queued/deferred and replayed once the
 * `connect()` promise resolves.
 */
export function createDeepgramSession(
  apiKey: string,
  opts: { diarize: boolean }
): DeepgramLiveConnectionLike {
  const deepgram = new DeepgramClient({ apiKey });

  const transcriptCallbacks: Array<(payload: DeepgramTranscriptPayload) => void> = [];
  const errorCallbacks: Array<(err: Error) => void> = [];
  const closeCallbacks: Array<() => void> = [];
  const pendingBuffers: Buffer[] = [];
  let finishRequestedBeforeReady = false;

  type LiveSocket = Awaited<ReturnType<typeof deepgram.listen.v1.connect>>;
  let socket: LiveSocket | undefined;

  deepgram.listen.v1
    .connect({
      model: "nova-2",
      encoding: "linear16",
      sample_rate: 16000,
      // v1 (unlike v2) genuinely supports diarize as a real streaming
      // option; the SDK models it as the string literals "true"/"false".
      diarize: opts.diarize ? "true" : "false",
      Authorization: apiKey,
    })
    .then((liveSocket) => {
      if (finishRequestedBeforeReady) {
        liveSocket.close();
        for (const cb of closeCallbacks) cb();
        return;
      }

      liveSocket.on("message", (data) => {
        if (data.type === "Results" && data.channel?.alternatives?.[0]) {
          const alt = data.channel.alternatives[0];
          const payload: DeepgramTranscriptPayload = {
            text: alt.transcript || "",
            isFinal: Boolean(data.is_final),
            durationMs: data.duration ? data.duration * 1000 : 0,
            confidence: alt.confidence || 0,
            speakerLabel:
              alt.words?.[0]?.speaker !== undefined
                ? String(alt.words[0].speaker)
                : undefined,
          };
          for (const cb of transcriptCallbacks) cb(payload);
        }
      });
      liveSocket.on("error", (err) => {
        for (const cb of errorCallbacks) cb(err);
      });
      liveSocket.on("close", () => {
        for (const cb of closeCallbacks) cb();
      });

      socket = liveSocket;
      for (const buffer of pendingBuffers) {
        liveSocket.sendMedia(buffer);
      }
      pendingBuffers.length = 0;
    })
    .catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const cb of errorCallbacks) cb(error);
    });

  return {
    onTranscript(cb) {
      transcriptCallbacks.push(cb);
    },
    onError(cb) {
      errorCallbacks.push(cb);
    },
    onClose(cb) {
      closeCallbacks.push(cb);
    },
    send(buffer) {
      if (socket) {
        socket.sendMedia(buffer);
      } else {
        pendingBuffers.push(buffer);
      }
    },
    finish() {
      if (socket) {
        socket.close();
      } else {
        finishRequestedBeforeReady = true;
      }
    },
  };
}
