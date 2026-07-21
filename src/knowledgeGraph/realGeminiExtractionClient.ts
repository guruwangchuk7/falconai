import { GoogleGenAI } from "@google/genai";
import type { ExtractionClientLike } from "./decisionExtractor.types";
import type { ExtractionResult } from "./knowledgeGraph.types";

const GEMINI_MODEL = "gemini-2.5-flash";

// Gemini's schema dialect is an OpenAPI subset -- unlike Anthropic's JSON
// Schema support, it has no `additionalProperties` field, so it's omitted
// here rather than carried over unused from realAnthropicExtractionClient.ts.
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
      },
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" } },
        required: ["label"],
      },
    },
  },
  required: ["decisions", "topics"],
};

const EXTRACTION_PROMPT_PREFIX =
  "Extract every concrete decision made in this meeting transcript: the decision text, " +
  "who made it (their speaker name exactly as it appears in the transcript), your confidence " +
  "from 0 to 1, and any topics/entities it references. Also list any other standalone " +
  "topics/entities mentioned in the transcript even if not tied to a specific decision.\n\n" +
  "Transcript:\n";

export function createRealGeminiExtractionClient(apiKey: string): ExtractionClientLike {
  const client = new GoogleGenAI({ apiKey });

  return {
    async extract(transcriptText: string): Promise<ExtractionResult> {
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: buildExtractionPrompt(transcriptText),
        config: {
          responseMimeType: "application/json",
          responseSchema: EXTRACTION_SCHEMA,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("Gemini response for decision extraction contained no text");
      }
      try {
        return JSON.parse(text) as ExtractionResult;
      } catch (err) {
        throw new Error(
          `Failed to parse Gemini's extraction result as JSON: ${text.slice(0, 200)}`,
          { cause: err }
        );
      }
    },
  };
}

function buildExtractionPrompt(transcriptText: string): string {
  return `${EXTRACTION_PROMPT_PREFIX}${transcriptText}`;
}
