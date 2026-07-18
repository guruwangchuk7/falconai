export interface LiveKitParticipant {
  participantId: string;
  displayName: string;
}

export interface LiveKitRoomLike {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  onAudioData(
    cb: (participantId: string, buffer: Buffer, timestamp: number) => void
  ): void;
  onDisconnected(cb: (reason: string) => void): void;
}

export interface LiveKitWebhookSource {
  onRoomStarted(
    cb: (payload: {
      meetingId: string;
      botToken: string;
      participants: LiveKitParticipant[];
    }) => void | Promise<void>
  ): void;
  onRoomFinished(cb: (payload: { meetingId: string }) => void): void;
  onParticipantJoined(
    cb: (payload: { meetingId: string; participant: LiveKitParticipant }) => void
  ): void;
  onParticipantLeft(
    cb: (payload: { meetingId: string; participantId: string }) => void
  ): void;
}
