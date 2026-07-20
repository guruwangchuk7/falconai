import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { GraphBuildStore } from "../../src/knowledgeGraph/graphBuildStore";

async function seedMeeting(meetingId: string, status: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM graph_builds WHERE meeting_id = $1`, [meetingId]);
  await pool.query(`DELETE FROM meetings WHERE meeting_id = $1`, [meetingId]);
  await pool.query(
    `INSERT INTO meetings (meeting_id, started_at, status) VALUES ($1, now(), $2)`,
    [meetingId, status]
  );
}

describe("GraphBuildStore", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it("returns ended meetings with no graph_builds row yet", async () => {
    await seedMeeting("graph-build-store-test-1", "ended");
    const store = new GraphBuildStore();

    const candidates = await store.findMeetingsNeedingBuild();

    expect(candidates).toContain("graph-build-store-test-1");
  });

  it("does not return active meetings", async () => {
    await seedMeeting("graph-build-store-test-active", "active");
    const store = new GraphBuildStore();

    const candidates = await store.findMeetingsNeedingBuild();

    expect(candidates).not.toContain("graph-build-store-test-active");
  });

  it("still returns a meeting stuck at processing (crash recovery)", async () => {
    await seedMeeting("graph-build-store-test-2", "ended_error");
    const store = new GraphBuildStore();
    await store.markProcessing("graph-build-store-test-2");

    const candidates = await store.findMeetingsNeedingBuild();

    expect(candidates).toContain("graph-build-store-test-2");
  });

  it("excludes a completed meeting", async () => {
    await seedMeeting("graph-build-store-test-3", "ended");
    const store = new GraphBuildStore();
    await store.markProcessing("graph-build-store-test-3");
    await store.markCompleted("graph-build-store-test-3");

    const candidates = await store.findMeetingsNeedingBuild();

    expect(candidates).not.toContain("graph-build-store-test-3");
  });

  it("excludes a failed meeting and records its error", async () => {
    await seedMeeting("graph-build-store-test-4", "ended");
    const store = new GraphBuildStore();
    await store.markProcessing("graph-build-store-test-4");
    await store.markFailed("graph-build-store-test-4", "Claude API error");

    const candidates = await store.findMeetingsNeedingBuild();
    expect(candidates).not.toContain("graph-build-store-test-4");

    const { rows } = await getPool().query(
      `SELECT status, error FROM graph_builds WHERE meeting_id = $1`,
      ["graph-build-store-test-4"]
    );
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toBe("Claude API error");
  });
});
