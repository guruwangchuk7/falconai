import rtms from "@zoom/rtms";
import { EventEmitter } from "node:events";
import type { ZoomWebhookSource } from "./zoomBotAdapter.types";

/**
 * Shared event bus bridging the real RTMS `Client` instance with
 * `ZoomWebhookSource`.
 *
 * `ZoomBotAdapter` registers `onParticipantJoined`/`onParticipantLeft`
 * exactly once, in its constructor — before any RTMS `Client` exists. A real
 * `Client` is only created later, inside `ZoomBotAdapter`'s `connectClient`
 * (see `createRealRtmsClient` in `./realRtmsClient.ts`), and potentially
 * recreated on every reconnect attempt. Zoom's own participant-event source
 * (`Client#onParticipantEvent`) is a method on that per-connection `Client`
 * instance, not a standalone webhook.
 *
 * To bridge these two lifecycles, both `createRealWebhookSource` (below) and
 * `createRealRtmsClient` share this single `EventEmitter` singleton:
 * `createRealRtmsClient` emits "participantJoined"/"participantLeft" from
 * inside its `client.onParticipantEvent(...)` handler (once a client exists),
 * and the `ZoomWebhookSource` returned here just subscribes to those same bus
 * events, decoupling registration order from client lifecycle.
 *
 * The RTMS-level events ("rtmsStarted"/"rtmsStopped", sourced from Zoom's
 * webhook rather than the Client) are routed through this same bus purely for
 * implementation uniformity across all four `ZoomWebhookSource` methods.
 */
export const zoomEventBus = new EventEmitter();

/**
 * Wires up the Zoom RTMS webhook receiver and exposes it as a
 * `ZoomWebhookSource`.
 *
 * Participant join/leave is NOT delivered via this webhook: the real RTMS SDK
 * surfaces it through `Client#onParticipantEvent`, a method on the
 * per-connection `Client` instance created inside `createRealRtmsClient`, so
 * this function does not subscribe to any `meeting.participant_joined` /
 * `meeting.participant_left` webhook event (unlike the brief's original,
 * stale assumption that those existed as separate Zoom Meetings webhooks).
 *
 * KNOWN AMBIGUITY (flagged for Task 16's live verification, not resolved
 * here): `@zoom/rtms`'s own doc comments in `rtms.d.ts` are internally
 * inconsistent about the exact shape of the webhook payload delivered to
 * `rtms.onWebhookEvent`. The `Client.join` example uses
 * `payload.payload.meeting_uuid` (fields nested under a `.payload` property),
 * while the `onWebhookEvent` example itself uses `payload.meeting_uuid`
 * (flat). This code defensively supports both: `body = payload.payload ??
 * payload` falls back to the flat shape when there is no nested `.payload`.
 *
 * Similarly, the exact event-name string is unconfirmed without a live
 * webhook delivery: the more authoritative `JoinParams` doc comment (which
 * discusses `meeting.rtms_started` webhooks feeding `meeting_uuid` into
 * `JoinParams`) implies the underscore-separated form
 * `"meeting.rtms_started"` / `"meeting.rtms_stopped"`, which is treated as
 * primary below. Zoom's public webhook documentation is also known to use
 * this underscore form for RTMS events. This must be reverified against a
 * real webhook delivery in Task 16 before production use.
 */
export function createRealWebhookSource(): ZoomWebhookSource {
  rtms.onWebhookEvent((payload: Record<string, any>) => {
    const event = payload.event;
    const body: Record<string, any> = payload.payload ?? payload;

    if (event === "meeting.rtms_started") {
      zoomEventBus.emit("rtmsStarted", {
        meetingId: body.meeting_uuid,
        joinPayload: body,
        participants: (body.participants ?? []).map((p: any) => ({
          participantId: String(p.user_id ?? p.participantId ?? ""),
          displayName: p.user_name ?? p.displayName ?? String(p.user_id ?? ""),
        })),
      });
    } else if (event === "meeting.rtms_stopped") {
      zoomEventBus.emit("rtmsStopped", { meetingId: body.meeting_uuid });
    }
    // No other event types are handled here: participant join/leave arrives
    // via the RTMS Client's onParticipantEvent, bridged in realRtmsClient.ts.
  });

  return {
    onRtmsStarted: (cb) => zoomEventBus.on("rtmsStarted", cb),
    onRtmsStopped: (cb) => zoomEventBus.on("rtmsStopped", cb),
    onParticipantJoined: (cb) => zoomEventBus.on("participantJoined", cb),
    onParticipantLeft: (cb) => zoomEventBus.on("participantLeft", cb),
  };
}
