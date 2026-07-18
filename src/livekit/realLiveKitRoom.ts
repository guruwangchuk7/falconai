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

  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (!(track instanceof RemoteAudioTrack)) return;
    const stream = new AudioStream(track, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS);
    void (async () => {
      for await (const frame of stream) {
        const buffer = Buffer.from(
          frame.data.buffer,
          frame.data.byteOffset,
          frame.data.byteLength
        );
        const timestamp = Date.now();
        for (const cb of audioDataCallbacks) cb(participant.identity, buffer, timestamp);
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
