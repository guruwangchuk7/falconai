import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { GraphWriter } from "../../src/knowledgeGraph/graphWriter";
import type { ExtractionResult, ParticipantMention } from "../../src/knowledgeGraph/knowledgeGraph.types";

async function seedMeeting(meetingId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM meetings WHERE meeting_id = $1`, [meetingId]);
  await pool.query(
    `INSERT INTO meetings (meeting_id, started_at, ended_at, status) VALUES ($1, now(), now(), 'ended')`,
    [meetingId]
  );
}

async function countNodesByType(meetingId: string, type: string): Promise<number> {
  const pool = getPool();
  if (type === "meeting") {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM graph_nodes WHERE type = 'meeting' AND natural_key = $1`,
      [meetingId]
    );
    return rows[0].count;
  }
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM graph_nodes gn
     WHERE gn.type = $2
       AND EXISTS (
         SELECT 1 FROM graph_edges ge
         JOIN graph_nodes meeting_node ON meeting_node.type = 'meeting' AND meeting_node.natural_key = $1
         WHERE ge.type IN ('PARTICIPATED_IN', 'MADE_IN')
           AND ((ge.from_node_id = gn.id AND ge.to_node_id = meeting_node.id))
       )`,
    [meetingId, type]
  );
  return rows[0].count;
}

describe("GraphWriter", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it("writes meeting, person, decision, and topic nodes with the right edges", async () => {
    const meetingId = "graph-writer-test-1";
    await seedMeeting(meetingId);

    const participants: ParticipantMention[] = [
      { participantId: "p1", speakerName: "Alex" },
      { participantId: "p2", speakerName: "Sam" },
    ];
    const extraction: ExtractionResult = {
      decisions: [
        { text: "Use Postgres for the graph store.", speakerName: "Alex", confidence: 0.9, topics: ["graph store"] },
      ],
      topics: [{ label: "graph store" }],
    };

    const writer = new GraphWriter();
    await writer.writeGraph(meetingId, participants, extraction);

    expect(await countNodesByType(meetingId, "meeting")).toBe(1);
    expect(await countNodesByType(meetingId, "person")).toBe(2);
    expect(await countNodesByType(meetingId, "decision")).toBe(1);

    const pool = getPool();
    const { rows: decisionRows } = await pool.query(
      `SELECT id, label FROM graph_nodes WHERE type = 'decision' AND label = 'Use Postgres for the graph store.'`
    );
    expect(decisionRows).toHaveLength(1);

    const { rows: madeEdges } = await pool.query(
      `SELECT ge.id FROM graph_edges ge
       JOIN graph_nodes person ON person.id = ge.from_node_id AND person.natural_key = 'alex'
       WHERE ge.to_node_id = $1 AND ge.type = 'MADE'`,
      [decisionRows[0].id]
    );
    expect(madeEdges).toHaveLength(1);

    const { rows: mentionsEdges } = await pool.query(
      `SELECT ge.id FROM graph_edges ge
       JOIN graph_nodes topic ON topic.id = ge.to_node_id AND topic.natural_key = 'graph store'
       WHERE ge.from_node_id = $1 AND ge.type = 'MENTIONS'`,
      [decisionRows[0].id]
    );
    expect(mentionsEdges).toHaveLength(1);
  });

  it("is idempotent: writing the same meeting twice does not duplicate nodes or edges", async () => {
    const meetingId = "graph-writer-test-2";
    await seedMeeting(meetingId);

    const participants: ParticipantMention[] = [{ participantId: "p1", speakerName: "Alex" }];
    const extraction: ExtractionResult = {
      decisions: [{ text: "Ship it.", speakerName: "Alex", confidence: 0.8, topics: [] }],
      topics: [],
    };

    const writer = new GraphWriter();
    await writer.writeGraph(meetingId, participants, extraction);
    await writer.writeGraph(meetingId, participants, extraction);

    expect(await countNodesByType(meetingId, "meeting")).toBe(1);
    expect(await countNodesByType(meetingId, "person")).toBe(1);
    expect(await countNodesByType(meetingId, "decision")).toBe(1);

    const pool = getPool();
    const { rows: participatedEdges } = await pool.query(
      `SELECT ge.id FROM graph_edges ge
       JOIN graph_nodes person ON person.id = ge.from_node_id AND person.natural_key = 'alex'
       JOIN graph_nodes meeting_node ON meeting_node.id = ge.to_node_id AND meeting_node.natural_key = $1
       WHERE ge.type = 'PARTICIPATED_IN'`,
      [meetingId]
    );
    expect(participatedEdges).toHaveLength(1);
  });
});
