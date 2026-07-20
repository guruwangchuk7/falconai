import { Room, RoomEvent, AudioStream, RemoteAudioTrack } from "@livekit/rtc-node";
import type { LiveKitRoomLike } from "./liveKitBotAdapter.types";

const AUDIO_SAMPLE_RATE = 16000;
const AUDIO_CHANNELS = 1;

export function createRealLiveKitRoom(): LiveKitRoomLike {
  const room = new Room();
  const audioDataCallbacks: Array<
    (participantId: string, buffer: Buffer, timestamp: number) => void
  > = [];
  const disconnectedCallbacks: Array<(reason: string) => void> = [];
  // Keyed by participant identity, not track sid: a participant only ever has one
  // meaningful mic stream for our purposes, and RoomEvent.TrackSubscribed can fire
  // more than once for the same participant (e.g. a WebRTC renegotiation/track
  // republish after a network blip) -- confirmed live (2026-07-19): after ~3.75
  // minutes a second TrackSubscribed fired for the same still-connected participant,
  // and without this guard both AudioStream loops kept running concurrently, both
  // pushing frames into audioDataCallbacks and interleaving two independent audio
  // streams into one corrupted byte sequence -- Deepgram kept receiving genuinely
  // non-silent audio (confirmed via per-frame amplitude) but silently returned empty
  // text / confidence 0 from that point on, since the interleaved bytes are not
  // valid PCM16 speech.
  const activeStreamsByParticipant = new Map<string, AudioStream>();

  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (!(track instanceof RemoteAudioTrack)) return;

    const previousStream = activeStreamsByParticipant.get(participant.identity);
    if (previousStream) {
      console.warn(
        `LiveKit re-subscribed to audio for ${participant.identity} while a previous stream was still active -- cancelling the old one`
      );
      void previousStream.cancel().catch(() => {});
    }

    const stream = new AudioStream(track, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS);
    activeStreamsByParticipant.set(participant.identity, stream);

    void (async () => {
      try {
        for await (const frame of stream) {
          const buffer = Buffer.from(
            frame.data.buffer,
            frame.data.byteOffset,
            frame.data.byteLength
          );
          const timestamp = Date.now();
          for (const cb of audioDataCallbacks) cb(participant.identity, buffer, timestamp);
        }
      } catch (err) {
        console.error(
          `LiveKit audio stream iteration failed for participant ${participant.identity}:`,
          err
        );
      } finally {
        if (activeStreamsByParticipant.get(participant.identity) === stream) {
          activeStreamsByParticipant.delete(participant.identity);
        }
      }
    })();
  });

  room.on(RoomEvent.Disconnected, (reason) => {
    for (const cb of disconnectedCallbacks) cb(String(reason));
  });

  return {
    async connect(url, token) {
      await room.connect(url, token);
    },
    async disconnect() {
      await room.disconnect();
    },
    onAudioData(cb) {
      audioDataCallbacks.push(cb);
    },
    onDisconnected(cb) {
      disconnectedCallbacks.push(cb);
    },
  };
}
