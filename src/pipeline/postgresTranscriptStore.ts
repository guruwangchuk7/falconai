import { getPool } from "../db/pool";
import type { TranscriptEvent } from "../types/transcriptEvent";

export class PostgresTranscriptStore {
  async openMeeting(meetingId: string): Promise<void> {
    await getPool().query(
      `INSERT INTO meetings (meeting_id, started_at, status) VALUES ($1, now(), 'active')
       ON CONFLICT (meeting_id) DO NOTHING`,
      [meetingId]
    );
  }

  async closeMeeting(
    meetingId: string,
    status: "ended" | "ended_error"
  ): Promise<void> {
    await getPool().query(
      `UPDATE meetings SET ended_at = now(), status = $2 WHERE meeting_id = $1`,
      [meetingId, status]
    );
  }

  async saveFinalEvent(event: TranscriptEvent): Promise<void> {
    if (!event.isFinal) {
      throw new Error("PostgresTranscriptStore only persists final events");
    }
    await getPool().query(
      `INSERT INTO transcript_events
        (meeting_id, utterance_id, participant_id, speaker_name, text, start_ts, end_ts, confidence, source, sequence_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (meeting_id, sequence_number) DO NOTHING`,
      [
        event.meetingId,
        event.utteranceId,
        event.participantId,
        event.speakerName,
        event.text,
        event.startTs,
        event.endTs,
        event.confidence,
        event.source,
        event.sequenceNumber,
      ]
    );
  }
}
