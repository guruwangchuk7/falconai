import { WebSocket } from "ws";
import type {
  DeepgramLiveConnectionLike,
  DeepgramTranscriptPayload,
} from "./deepgramLiveConnection.types";

const DEEPGRAM_LISTEN_URL = "wss://api.deepgram.com/v1/listen";

/**
 * Creates a Deepgram live transcription session via a direct WebSocket
 * connection to Deepgram's `/v1/listen` endpoint, rather than
 * `@deepgram/sdk`'s `listen.v1.connect()` wrapper.
 *
 * That wrapper's `ReconnectingWebSocket` never reached OPEN in this
 * environment even with valid credentials (readyState stuck at CLOSED
 * indefinitely, no close/error event ever fired) -- confirmed via the `ws`
 * package succeeding with an identical URL/headers, which isolated the fault
 * to the SDK wrapper itself, not our auth or connection params.
 * `TranscriptionManager` (see its reconnect-with-buffering logic) already
 * owns reconnect responsibility, so a plain WebSocket here is sufficient
 * without another reconnect layer underneath it.
 *
 * Auth note: Deepgram requires the header value `Token <apiKey>` -- the bare
 * key alone is rejected with a 401 `INVALID_AUTH`.
 */
export function createDeepgramSession(
  apiKey: string,
  opts: { diarize: boolean }
): DeepgramLiveConnectionLike {
  const params = new URLSearchParams({
    model: "nova-2",
    encoding: "linear16",
    sample_rate: "16000",
    smart_format: "true",
    interim_results: "true",
    diarize: opts.diarize ? "true" : "false",
  });
  const socket = new WebSocket(`${DEEPGRAM_LISTEN_URL}?${params.toString()}`, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  const transcriptCallbacks: Array<(payload: DeepgramTranscriptPayload) => void> = [];
  const errorCallbacks: Array<(err: Error) => void> = [];
  const closeCallbacks: Array<() => void> = [];
  const pendingBuffers: Buffer[] = [];

  socket.on("open", () => {
    for (const buffer of pendingBuffers) {
      socket.send(buffer);
    }
    pendingBuffers.length = 0;
  });

  socket.on("message", (data: Buffer) => {
    let parsed: any;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (parsed.type !== "Results") return;
    const alt = parsed.channel?.alternatives?.[0];
    if (!alt) return;
    const payload: DeepgramTranscriptPayload = {
      text: alt.transcript || "",
      isFinal: Boolean(parsed.is_final),
      durationMs: parsed.duration ? parsed.duration * 1000 : 0,
      confidence: alt.confidence || 0,
      speakerLabel:
        alt.words?.[0]?.speaker !== undefined ? String(alt.words[0].speaker) : undefined,
    };
    for (const cb of transcriptCallbacks) cb(payload);
  });

  socket.on("error", (err: Error) => {
    for (const cb of errorCallbacks) cb(err);
  });

  socket.on("unexpected-response", (_req, res) => {
    const error = new Error(
      `Deepgram connection rejected: HTTP ${res.statusCode} ${res.statusMessage}`
    );
    for (const cb of errorCallbacks) cb(error);
  });

  socket.on("close", () => {
    for (const cb of closeCallbacks) cb();
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
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(buffer);
      } else {
        pendingBuffers.push(buffer);
      }
    },
    finish() {
      socket.close();
    },
  };
}
