import rtms, { type JoinParams } from "@zoom/rtms";
import type { RtmsClientLike } from "./zoomBotAdapter.types";
import { zoomEventBus } from "./realWebhookSource";

// Cross-check these enum names against the installed @zoom/rtms type
// definitions and docs/superpowers/notes/zoom-rtms-capability-findings.md
// (Task 1) before relying on them in production. Confirmed directly against
// node_modules/@zoom/rtms/rtms.d.ts for this task: AudioCodec, AudioSampleRate,
// AudioChannel, and AudioDataOption are plain objects with numeric properties
// (not TypeScript `enum`s), exposed only as properties of the default export
// object (there is no `export const AudioCodec = {...}` value export
// alongside the type-only `export interface AudioCodec {...}`).
export const PRODUCTION_AUDIO_PARAMS = {
  codec: rtms.AudioCodec.L16,
  sampleRate: rtms.AudioSampleRate.SR_16K,
  channel: rtms.AudioChannel.MONO,
  dataOpt: rtms.AudioDataOption.AUDIO_MULTI_STREAMS,
};

// Per rtms.d.ts's doc comment on Client#onJoinConfirm: "0 = success, other
// values indicate specific error conditions." This convention must be
// reverified during Task 16's live run before being trusted in production.
const JOIN_CONFIRM_SUCCESS_REASON = 0;

/**
 * Wraps the real `@zoom/rtms` `Client` to satisfy `RtmsClientLike`.
 *
 * Key differences from a naive wrapping, driven by facts read directly out of
 * `node_modules/@zoom/rtms/rtms.d.ts` (not assumed):
 *
 * 1. The real `Client#join` is synchronous and returns a boolean (whether the
 *    SDK dispatched the join request), not a Promise, and does not
 *    itself surface connection success/failure. That signal arrives later via
 *    `Client#onJoinConfirm`. `RtmsClientLike.join` is
 *    `Promise<void> | void`, so this wrapper registers an `onJoinConfirm`
 *    handler that settles a Promise, then calls the real synchronous
 *    `client.join(...)`, rejecting immediately if that call itself returns
 *    `false` (meaning the SDK refused to even dispatch the request).
 *
 * 2. `Metadata#userId` and the `userId` parameter of
 *    `ActiveSpeakerEventCallback` are `number` in the real SDK, but
 *    `RtmsClientLike`'s callbacks expect `userId: string` — converted here
 *    via `String(...)`.
 *
 * 3. Participant join/leave comes from `Client#onParticipantEvent`, a method
 *    on this per-connection client instance — not from a webhook. Since
 *    `ZoomBotAdapter` registers `onParticipantJoined`/`onParticipantLeft` once
 *    in its constructor, before any client exists, this function bridges the
 *    two via the shared `zoomEventBus` (see `./realWebhookSource.ts`),
 *    emitting "participantJoined"/"participantLeft" from inside
 *    `onParticipantEvent`. `client.uuid()` supplies the meeting ID for these
 *    emitted events.
 */
export function createRealRtmsClient(): RtmsClientLike {
  const client = new rtms.Client();

  client.onParticipantEvent((event, _timestamp, participants) => {
    const meetingId = client.uuid();
    for (const p of participants) {
      const participantId = String(p.userId);
      if (event === "join") {
        zoomEventBus.emit("participantJoined", {
          meetingId,
          participant: { participantId, displayName: p.userName ?? participantId },
        });
      } else {
        zoomEventBus.emit("participantLeft", { meetingId, participantId });
      }
    }
  });

  return {
    join(payload: unknown): Promise<void> {
      return new Promise((resolve, reject) => {
        // Registered before the synchronous join() call below so we cannot
        // miss a confirmation that arrives on the very next tick.
        client.onJoinConfirm((reason) => {
          if (reason === JOIN_CONFIRM_SUCCESS_REASON) {
            resolve();
          } else {
            reject(new Error(`RTMS join was not confirmed (reason code ${reason})`));
          }
        });

        const dispatched = client.join(payload as JoinParams);
        if (!dispatched) {
          reject(new Error("RTMS client.join() returned false: the SDK refused to dispatch the join request"));
        }
      });
    },

    leave(): void {
      client.leave();
    },

    setAudioParams(params: Record<string, number>): void {
      client.setAudioParams(params);
    },

    onAudioData(cb): void {
      client.onAudioData((buffer, size, timestamp, metadata) => {
        cb(buffer, size, timestamp, {
          userId: String(metadata.userId),
          userName: metadata.userName,
        });
      });
    },

    onActiveSpeakerEvent(cb): void {
      client.onActiveSpeakerEvent((timestamp, userId, userName) => {
        cb(timestamp, String(userId), userName);
      });
    },

    onJoinConfirm(cb): void {
      // Passthrough to satisfy the RtmsClientLike interface. Nothing in this
      // codebase currently calls a client's onJoinConfirm through this
      // interface method — join()'s own internal onJoinConfirm registration
      // above is what's used for connection-success detection. If some future
      // caller does invoke this passthrough, it will independently coexist
      // with (not necessarily conflict with) the internal registration only
      // if the real SDK supports multiple concurrently-registered
      // onJoinConfirm handlers; if instead (as is common for these SDKs) the
      // real Client#onJoinConfirm simply replaces the single registered
      // handler, calling this passthrough would silently break the internal
      // join()-success detection. This is a known limitation, left
      // unresolved since nothing currently exercises this path.
      client.onJoinConfirm(cb);
    },

    onLeave(cb): void {
      client.onLeave(cb);
    },
  };
}
