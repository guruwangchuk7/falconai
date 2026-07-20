import { getPool } from "../db/pool";

export class GraphBuildStore {
  async findMeetingsNeedingBuild(): Promise<string[]> {
    const { rows } = await getPool().query(
      `SELECT m.meeting_id AS "meetingId"
       FROM meetings m
       LEFT JOIN graph_builds gb ON gb.meeting_id = m.meeting_id
       WHERE m.status IN ('ended', 'ended_error')
         AND (gb.meeting_id IS NULL OR gb.status = 'processing')`
    );
    return rows.map((row: { meetingId: string }) => row.meetingId);
  }

  async markProcessing(meetingId: string): Promise<void> {
    await getPool().query(
      `INSERT INTO graph_builds (meeting_id, status, started_at)
       VALUES ($1, 'processing', now())
       ON CONFLICT (meeting_id) DO UPDATE SET status = 'processing', started_at = now(), error = NULL`,
      [meetingId]
    );
  }

  async markCompleted(meetingId: string): Promise<void> {
    await getPool().query(
      `UPDATE graph_builds SET status = 'completed', completed_at = now() WHERE meeting_id = $1`,
      [meetingId]
    );
  }

  async markFailed(meetingId: string, error: string): Promise<void> {
    await getPool().query(
      `UPDATE graph_builds SET status = 'failed', error = $2, completed_at = now() WHERE meeting_id = $1`,
      [meetingId, error]
    );
  }
}
