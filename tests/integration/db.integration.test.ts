import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";

describe("database schema", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it("allows inserting and reading a meeting row", async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO meetings (meeting_id, started_at, status) VALUES ($1, now(), 'active')
       ON CONFLICT (meeting_id) DO NOTHING`,
      ["test-meeting-1"]
    );
    const { rows } = await pool.query(
      "SELECT status FROM meetings WHERE meeting_id = $1",
      ["test-meeting-1"]
    );
    expect(rows[0].status).toBe("active");
  });
});
