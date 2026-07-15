import { DeepgramClient } from "@deepgram/sdk";
import type { DeepgramLiveConnectionLike } from "./deepgramLiveConnection.types";

export async function createDeepgramSession(
  apiKey: string,
  opts: { diarize: boolean }
): Promise<DeepgramLiveConnectionLike> {
  const deepgram = new DeepgramClient({ apiKey });
  const live = await deepgram.listen.v2.connect({
    model: "nova-2",
    encoding: "linear16",
    sample_rate: 16000,
    Authorization: apiKey,
    // Note: v2 API doesn't have diarize parameter in the same way,
    // it's configured differently. This is a placeholder for now.
  });

  return {
    onTranscript(cb) {
      live.on("message", (data: any) => {
        // Handle v2 API response format
        if (data.type === "Results" && data.channel?.alternatives?.[0]) {
          const alt = data.channel.alternatives[0];
          cb({
            text: alt.transcript || "",
            isFinal: Boolean(data.is_final),
            durationMs: data.duration ? data.duration * 1000 : 0,
            confidence: alt.confidence || 0,
            speakerLabel:
              alt.words?.[0]?.speaker !== undefined
                ? String(alt.words[0].speaker)
                : undefined,
          });
        }
      });
    },
    onError(cb) {
      live.on("error", cb);
    },
    onClose(cb) {
      live.on("close", cb);
    },
    send(buffer) {
      live.sendMedia(buffer);
    },
    finish() {
      live.close();
    },
  };
}
