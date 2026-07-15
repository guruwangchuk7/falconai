interface SpeakerWindow {
  participantId: string;
  startTs: number;
  endTs: number;
}

export class ActiveSpeakerTimeline {
  private windows: SpeakerWindow[] = [];

  recordActiveSpeaker(participantId: string, atTs: number): void {
    const last = this.windows[this.windows.length - 1];
    if (last) {
      last.endTs = atTs;
      if (last.participantId === participantId) {
        // Same speaker again: keep their window open (see below), nothing else to do.
        last.endTs = Infinity;
        return;
      }
    }
    // The newly active speaker's window stays open (endTs = Infinity) until
    // the next recordActiveSpeaker call closes it out — they're presumed to
    // still be speaking until we hear otherwise.
    this.windows.push({ participantId, startTs: atTs, endTs: Infinity });
  }

  resolveParticipant(startTs: number, endTs: number): string | undefined {
    let best: { participantId: string; overlap: number } | undefined;
    for (const w of this.windows) {
      const windowEnd = w.endTs === Infinity ? endTs : w.endTs;
      const overlap = Math.min(endTs, windowEnd) - Math.max(startTs, w.startTs);
      if (overlap > 0 && (!best || overlap > best.overlap)) {
        best = { participantId: w.participantId, overlap };
      }
    }
    return best?.participantId;
  }
}
