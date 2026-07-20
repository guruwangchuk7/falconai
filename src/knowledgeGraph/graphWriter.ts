import type { PoolClient } from "pg";
import { getPool } from "../db/pool";
import type { ExtractionResult, ParticipantMention } from "./knowledgeGraph.types";

export class GraphWriter {
  async writeGraph(
    meetingId: string,
    participants: ParticipantMention[],
    extraction: ExtractionResult
  ): Promise<void> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");

      const meetingNodeId = await upsertNode(client, "meeting", meetingId, meetingId, {});

      // Delete any decision nodes this meeting already wrote (e.g. from a crashed,
      // now-retried build) before re-inserting -- decision nodes have no natural_key,
      // so without this cleanup a retry would duplicate every decision. FK ON DELETE
      // CASCADE removes their MADE_IN/MADE/MENTIONS edges automatically.
      await client.query(
        `DELETE FROM graph_nodes
         WHERE type = 'decision'
           AND id IN (
             SELECT from_node_id FROM graph_edges WHERE to_node_id = $1 AND type = 'MADE_IN'
           )`,
        [meetingNodeId]
      );

      const personNodeIdsBySpeakerName = new Map<string, string>();
      for (const participant of participants) {
        const naturalKey = participant.speakerName.trim().toLowerCase();
        const personNodeId = await upsertNode(client, "person", naturalKey, participant.speakerName, {});
        personNodeIdsBySpeakerName.set(naturalKey, personNodeId);
        await insertEdgeIfAbsent(client, personNodeId, meetingNodeId, "PARTICIPATED_IN");
      }

      const topicNodeIdsByNaturalKey = new Map<string, string>();
      for (const topic of extraction.topics) {
        const naturalKey = topic.label.trim().toLowerCase();
        const topicNodeId = await upsertNode(client, "topic", naturalKey, topic.label, {});
        topicNodeIdsByNaturalKey.set(naturalKey, topicNodeId);
      }

      for (const decision of extraction.decisions) {
        const { rows } = await client.query(
          `INSERT INTO graph_nodes (type, natural_key, label, attributes)
           VALUES ('decision', NULL, $1, $2)
           RETURNING id`,
          [decision.text, JSON.stringify({ confidence: decision.confidence })]
        );
        const decisionNodeId = rows[0].id as string;

        await insertEdgeIfAbsent(client, decisionNodeId, meetingNodeId, "MADE_IN");

        const speakerNaturalKey = decision.speakerName.trim().toLowerCase();
        const speakerNodeId = personNodeIdsBySpeakerName.get(speakerNaturalKey);
        if (speakerNodeId) {
          await insertEdgeIfAbsent(client, speakerNodeId, decisionNodeId, "MADE");
        }

        for (const topicLabel of decision.topics) {
          const naturalKey = topicLabel.trim().toLowerCase();
          let topicNodeId = topicNodeIdsByNaturalKey.get(naturalKey);
          if (!topicNodeId) {
            topicNodeId = await upsertNode(client, "topic", naturalKey, topicLabel, {});
            topicNodeIdsByNaturalKey.set(naturalKey, topicNodeId);
          }
          await insertEdgeIfAbsent(client, decisionNodeId, topicNodeId, "MENTIONS");
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

async function upsertNode(
  client: PoolClient,
  type: string,
  naturalKey: string,
  label: string,
  attributes: Record<string, unknown>
): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO graph_nodes (type, natural_key, label, attributes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (type, natural_key) WHERE natural_key IS NOT NULL DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    [type, naturalKey, label, JSON.stringify(attributes)]
  );
  return rows[0].id as string;
}

async function insertEdgeIfAbsent(
  client: PoolClient,
  fromNodeId: string,
  toNodeId: string,
  type: string
): Promise<void> {
  await client.query(
    `INSERT INTO graph_edges (from_node_id, to_node_id, type)
     VALUES ($1, $2, $3)
     ON CONFLICT (from_node_id, to_node_id, type) DO NOTHING`,
    [fromNodeId, toNodeId, type]
  );
}
