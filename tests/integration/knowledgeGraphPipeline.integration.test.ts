import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { GraphBuildStore } from "../../src/knowledgeGraph/graphBuildStore";
import { TranscriptFetcher } from "../../src/knowledgeGraph/transcriptFetcher";
import { GraphWriter } from "../../src/knowledgeGraph/graphWriter";
import { KnowledgeGraphWorker } from "../../src/knowledgeGraph/knowledgeGraphWorker";
import type { ExtractionResult } from "../../src/knowledgeGraph/knowledgeGraph.types";

describe("Knowledge Graph Builder end-to-end pipeline", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it("processes an ended meeting's real transcript into a real graph, then skips it on the next poll", async () => {
    const meetingId = "kg-pipeline-test-1";
    const pool = getPool();
    await pool.query(`DELETE FROM graph_builds WHERE meeting_id = $1`, [meetingId]);
    await pool.query(`DELETE FROM transcript_events WHERE meeting_id = $1`, [meetingId]);
    await pool.query(`DELETE FROM meetings WHERE meeting_id = $1`, [meetingId]);
    await pool.query(
      `INSERT INTO meetings (meeting_id, started_at, ended_at, status) VALUES ($1, now(), now(), 'ended')`,
      [meetingId]
    );
    await pool.query(
      `INSERT INTO transcript_events
        (meeting_id, utterance_id, participant_id, speaker_name, text, start_ts, end_ts, confidence, source, sequence_number)
       VALUES
        ($1, 'u1', 'p1', 'Alex', 'Let''s use Postgres for the graph store.', 0, 400, 0.95, 'deepgram', 1),
        ($1, 'u2', 'p2', 'Sam', 'Agreed.', 500, 700, 0.9, 'deepgram', 2)`,
      [meetingId]
    );

    const extractionResult: ExtractionResult = {
      decisions: [
        { text: "Use Postgres for the graph store.", speakerName: "Alex", confidence: 0.9, topics: ["graph store"] },
      ],
      topics: [{ label: "graph store" }],
    };
    const fakeExtractor = { extract: vi.fn().mockResolvedValue(extractionResult) };

    const worker = new KnowledgeGraphWorker({
      buildStore: new GraphBuildStore(),
      fetcher: new TranscriptFetcher(),
      extractor: fakeExtractor,
      writer: new GraphWriter(),
      onAlert: (msg, err) => console.error(msg, err),
    });

    // Exercise the scoped processMeeting(), not the unscoped pollOnce() sweep --
    // GraphBuildStore.findMeetingsNeedingBuild() has no meeting-id filter, so
    // pollOnce() also processes every other 'ended' meeting already sitting in this
    // shared dev/test database (including other integration test files' own fixture
    // meetings running concurrently), which pollutes their graphs with this test's
    // fake extractor output and makes the call-count assertions below flaky/wrong.
    await worker.processMeeting(meetingId);

    const { rows: buildRows } = await pool.query(
      `SELECT status FROM graph_builds WHERE meeting_id = $1`,
      [meetingId]
    );
    expect(buildRows[0].status).toBe("completed");

    // Scoped to this test's own meeting node via its MADE_IN edge rather than a bare
    // `WHERE label = ...` match -- see the "Self-review findings" note in
    // .superpowers/sdd/task-9-report.md: GraphBuildStore.findMeetingsNeedingBuild()
    // has no scoping, so pollOnce() also sweeps up every other 'ended' meeting already
    // sitting in the shared dev/test database (including tests/integration/graphWriter
    // .integration.test.ts's own fixture, which uses this exact same decision text) --
    // an unscoped query here would be a false negative unrelated to what this test
    // actually verifies.
    const { rows: decisionRows } = await pool.query(
      `SELECT gn.label FROM graph_nodes gn
       JOIN graph_edges ge ON ge.from_node_id = gn.id AND ge.type = 'MADE_IN'
       JOIN graph_nodes m ON m.id = ge.to_node_id AND m.type = 'meeting' AND m.natural_key = $1
       WHERE gn.type = 'decision' AND gn.label = 'Use Postgres for the graph store.'`,
      [meetingId]
    );
    expect(decisionRows).toHaveLength(1);
    expect(fakeExtractor.extract).toHaveBeenCalledTimes(1);

    // A completed meeting must not be picked up as a candidate on the next poll tick.
    // Checked via GraphBuildStore directly (same tolerant contains/not-contains style
    // as graphBuildStore.integration.test.ts) rather than calling the real, unscoped
    // pollOnce() again -- see the comment above about why that sweeps unrelated
    // meetings in this shared database.
    const candidatesAfterCompletion = await new GraphBuildStore().findMeetingsNeedingBuild();
    expect(candidatesAfterCompletion).not.toContain(meetingId);
  });
});
