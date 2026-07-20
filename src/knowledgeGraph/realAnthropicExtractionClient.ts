import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicExtractionClientLike } from "./decisionExtractor.types";
import type { ExtractionResult } from "./knowledgeGraph.types";

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          speakerName: { type: "string" },
          confidence: { type: "number" },
          topics: { type: "array", items: { type: "string" } },
        },
        required: ["text", "speakerName", "confidence", "topics"],
        additionalProperties: false,
      },
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" } },
        required: ["label"],
        additionalProperties: false,
      },
    },
  },
  required: ["decisions", "topics"],
  additionalProperties: false,
};

const EXTRACTION_PROMPT_PREFIX =
  "Extract every concrete decision made in this meeting transcript: the decision text, " +
  "who made it (their speaker name exactly as it appears in the transcript), your confidence " +
  "from 0 to 1, and any topics/entities it references. Also list any other standalone " +
  "topics/entities mentioned in the transcript even if not tied to a specific decision.\n\n" +
  "Transcript:\n";

export function createRealAnthropicExtractionClient(apiKey: string): AnthropicExtractionClientLike {
  const client = new Anthropic({ apiKey });

  return {
    async extract(transcriptText: string): Promise<ExtractionResult> {
      const response = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 4096,
        output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
        messages: [{ role: "user", content: buildExtractionPrompt(transcriptText) }],
      });

      if (response.stop_reason !== "end_turn") {
        throw new Error(
          `Claude decision extraction did not complete normally (stop_reason: ${response.stop_reason})`
        );
      }

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      if (!textBlock) {
        throw new Error("Claude response for decision extraction contained no text block");
      }
      try {
        return JSON.parse(textBlock.text) as ExtractionResult;
      } catch (err) {
        throw new Error(
          `Failed to parse Claude's extraction result as JSON: ${textBlock.text.slice(0, 200)}`,
          { cause: err }
        );
      }
    },
  };
}

function buildExtractionPrompt(transcriptText: string): string {
  return `${EXTRACTION_PROMPT_PREFIX}${transcriptText}`;
}
