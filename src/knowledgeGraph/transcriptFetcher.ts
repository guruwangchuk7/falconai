import { getPool } from "../db/pool";
import { formatTranscriptForExtraction } from "./transcriptFormatter";
import type { FormattedTranscript } from "./knowledgeGraph.types";

export class TranscriptFetcher {
  async fetchFormattedTranscript(meetingId: string): Promise<FormattedTranscript> {
    const { rows } = await getPool().query(
      `SELECT participant_id AS "participantId", speaker_name AS "speakerName", text, start_ts::int AS "startTs"
       FROM transcript_events
       WHERE meeting_id = $1
       ORDER BY sequence_number`,
      [meetingId]
    );
    return formatTranscriptForExtraction(rows);
  }
}
