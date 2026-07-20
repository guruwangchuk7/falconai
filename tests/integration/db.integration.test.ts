import "dotenv/config";
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

  it("enforces unique (type, natural_key) on graph_nodes, ignoring rows with a null natural_key", async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO graph_nodes (type, natural_key, label) VALUES ('person', 'alex', 'Alex')`
    );
    await expect(
      pool.query(`INSERT INTO graph_nodes (type, natural_key, label) VALUES ('person', 'alex', 'Alex Again')`)
    ).rejects.toThrow();
    // Two decision nodes (natural_key IS NULL) must NOT collide with each other.
    await pool.query(`INSERT INTO graph_nodes (type, natural_key, label) VALUES ('decision', NULL, 'Decision A')`);
    await pool.query(`INSERT INTO graph_nodes (type, natural_key, label) VALUES ('decision', NULL, 'Decision B')`);
    const { rows } = await pool.query(`SELECT label FROM graph_nodes WHERE type = 'decision' ORDER BY label`);
    expect(rows).toHaveLength(2);
  });

  it("cascades edge deletes when a node is deleted, and rejects duplicate edges", async () => {
    const pool = getPool();
    const { rows: nodeRows } = await pool.query(
      `INSERT INTO graph_nodes (type, natural_key, label) VALUES ('person', 'cascade-test-person', 'Cascade Test'), ('meeting', 'cascade-test-meeting', 'cascade-test-meeting') RETURNING id, type`
    );
    const personId = nodeRows.find((r: { type: string }) => r.type === "person").id;
    const meetingId = nodeRows.find((r: { type: string }) => r.type === "meeting").id;

    await pool.query(
      `INSERT INTO graph_edges (from_node_id, to_node_id, type) VALUES ($1, $2, 'PARTICIPATED_IN')`,
      [personId, meetingId]
    );
    await expect(
      pool.query(
        `INSERT INTO graph_edges (from_node_id, to_node_id, type) VALUES ($1, $2, 'PARTICIPATED_IN')`,
        [personId, meetingId]
      )
    ).rejects.toThrow();

    await pool.query(`DELETE FROM graph_nodes WHERE id = $1`, [personId]);
    const { rows: edgeRows } = await pool.query(
      `SELECT id FROM graph_edges WHERE from_node_id = $1`,
      [personId]
    );
    expect(edgeRows).toHaveLength(0);
  });

  it("allows inserting and reading a graph_builds row scoped to an existing meeting", async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO meetings (meeting_id, started_at, status) VALUES ($1, now(), 'ended') ON CONFLICT (meeting_id) DO NOTHING`,
      ["graph-builds-schema-test"]
    );
    await pool.query(
      `INSERT INTO graph_builds (meeting_id, status, started_at) VALUES ($1, 'processing', now())
       ON CONFLICT (meeting_id) DO UPDATE SET status = 'processing'`,
      ["graph-builds-schema-test"]
    );
    const { rows } = await pool.query(
      `SELECT status FROM graph_builds WHERE meeting_id = $1`,
      ["graph-builds-schema-test"]
    );
    expect(rows[0].status).toBe("processing");
  });
});
