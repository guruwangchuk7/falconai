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

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      if (!textBlock) {
        throw new Error("Claude response for decision extraction contained no text block");
      }
      return JSON.parse(textBlock.text) as ExtractionResult;
    },
  };
}

function buildExtractionPrompt(transcriptText: string): string {
  return `${EXTRACTION_PROMPT_PREFIX}${transcriptText}`;
}
