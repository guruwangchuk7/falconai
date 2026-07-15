export interface Participant {
  participantId: string;
  displayName: string;
}

export interface RtmsClientLike {
  join(payload: unknown): Promise<void> | void;
  leave(): Promise<void> | void;
  setAudioParams(params: Record<string, number>): void;
  onAudioData(
    cb: (
      buffer: Buffer,
      size: number,
      timestamp: number,
      metadata: { userId: string; userName: string }
    ) => void
  ): void;
  onActiveSpeakerEvent(
    cb: (timestamp: number, userId: string, userName: string) => void
  ): void;
  onJoinConfirm(cb: (reason: number) => void): void;
  onLeave(cb: (reason: number) => void): void;
}

export interface ZoomWebhookSource {
  onRtmsStarted(
    cb: (payload: {
      meetingId: string;
      joinPayload: unknown;
      participants: Participant[];
    }) => void | Promise<void>
  ): void;
  onRtmsStopped(cb: (payload: { meetingId: string }) => void): void;
  onParticipantJoined(
    cb: (payload: { meetingId: string; participant: Participant }) => void
  ): void;
  onParticipantLeft(
    cb: (payload: { meetingId: string; participantId: string }) => void
  ): void;
}
