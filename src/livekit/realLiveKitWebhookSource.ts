// src/livekit/realLiveKitWebhookSource.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebhookReceiver, AccessToken } from "livekit-server-sdk";
import type { LiveKitWebhookSource, LiveKitParticipant } from "./liveKitBotAdapter.types";

export interface RealLiveKitWebhookSourceDeps {
  apiKey: string;
  apiSecret: string;
  botIdentity: string;
}

export function createRealLiveKitWebhookSource(
  deps: RealLiveKitWebhookSourceDeps
): { source: LiveKitWebhookSource; handleWebhookRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void> } {
  const receiver = new WebhookReceiver(deps.apiKey, deps.apiSecret);

  const roomStartedHandlers: Array<
    (payload: { meetingId: string; botToken: string; participants: LiveKitParticipant[] }) => void
  > = [];
  const roomFinishedHandlers: Array<(payload: { meetingId: string }) => void> = [];
  const participantJoinedHandlers: Array<
    (payload: { meetingId: string; participant: LiveKitParticipant }) => void
  > = [];
  const participantLeftHandlers: Array<
    (payload: { meetingId: string; participantId: string }) => void
  > = [];

  async function handleWebhookRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf-8");

    let event;
    try {
      event = await receiver.receive(body, req.headers.authorization);
    } catch (err) {
      res.writeHead(401).end("invalid webhook signature");
      console.error("LiveKit webhook signature verification failed", err);
      return;
    }

    if (event.event === "room_started" && event.room) {
      const botToken = new AccessToken(deps.apiKey, deps.apiSecret, {
        identity: deps.botIdentity,
      });
      botToken.addGrant({
        roomJoin: true,
        room: event.room.name,
        canPublish: false,
        canSubscribe: true,
      });
      const jwt = await botToken.toJwt();
      for (const cb of roomStartedHandlers) {
        cb({ meetingId: event.room.name, botToken: jwt, participants: [] });
      }
    } else if (event.event === "room_finished" && event.room) {
      for (const cb of roomFinishedHandlers) cb({ meetingId: event.room.name });
    } else if (event.event === "participant_joined" && event.room && event.participant) {
      for (const cb of participantJoinedHandlers) {
        cb({
          meetingId: event.room.name,
          participant: {
            participantId: event.participant.identity,
            displayName: event.participant.name || event.participant.identity,
          },
        });
      }
    } else if (event.event === "participant_left" && event.room && event.participant) {
      for (const cb of participantLeftHandlers) {
        cb({ meetingId: event.room.name, participantId: event.participant.identity });
      }
    }

    res.writeHead(200).end("ok");
  }

  return {
    source: {
      onRoomStarted: (cb) => roomStartedHandlers.push(cb),
      onRoomFinished: (cb) => roomFinishedHandlers.push(cb),
      onParticipantJoined: (cb) => participantJoinedHandlers.push(cb),
      onParticipantLeft: (cb) => participantLeftHandlers.push(cb),
    },
    handleWebhookRequest,
  };
}
