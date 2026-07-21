# Gemini Extraction Client — Design

**Status:** Approved
**Date:** 2026-07-21

## Context

The Knowledge Graph Builder's `DecisionExtractor` (see
`docs/superpowers/specs/2026-07-20-knowledge-graph-builder-design.md`) depends
on a real Claude client, `realAnthropicExtractionClient.ts`. The first live
end-to-end test (2026-07-21) reached this client for the first time and it
returned `400 invalid_request_error: "Your credit balance is too low to
access the Anthropic API."` — the account has zero funding right now.

The user has no budget for paid API access at this stage and plans to move
back to Anthropic once the project has funding or sponsors. Google Gemini has
a usable free tier and is the practical choice to unblock live verification
now.

## Goals

- Get a real, working `extract()` implementation with zero-cost API access.
- Keep today's constraint (no funding) from leaking into the shape of the
  code — the eventual move back to Anthropic should be a config change, not
  a rewrite.
- Preserve everything downstream of extraction (`ExtractionResult` shape,
  `GraphWriter`, `KnowledgeGraphWorker`) completely unchanged.

## Non-goals

- No changes to the extraction schema, prompt intent, or `GraphWriter`.
- No abstraction beyond a single env-var toggle — no plugin registry, no
  runtime provider auto-detection, no third provider scaffolded speculatively.
- No unit tests for the new real client, matching this repo's existing
  convention for real adapters (`realRtmsClient.ts`, `realLiveKitRoom.ts`,
  `realAnthropicExtractionClient.ts`) — they need live credentials and are
  deliberately excluded from unit coverage.

## Design

`DecisionExtractor` already depends only on a narrow interface —
`extract(transcriptText): Promise<ExtractionResult>` — not on the Anthropic
SDK directly. Swapping providers is therefore an adapter swap, not a design
change to the extraction pipeline itself.

1. **Rename the interface.** `AnthropicExtractionClientLike` (in
   `decisionExtractor.types.ts`) becomes `ExtractionClientLike` — the name was
   only ever provider-specific because Anthropic was the sole implementer;
   now that Gemini also satisfies it, the old name is actively misleading.
   Mechanical rename, no behavior change.

2. **New `src/knowledgeGraph/realGeminiExtractionClient.ts`.** Same shape as
   `realAnthropicExtractionClient.ts`: its own copy of the extraction prompt
   and JSON schema (not shared with the Anthropic client — each real adapter
   in this repo is self-contained, and the two providers' schema dialects
   differ: Gemini's OpenAPI-subset schema has no `additionalProperties`
   field, so it's simply omitted here rather than carried over unused).
   Uses `@google/genai`'s `GoogleGenAI.models.generateContent()` with
   `model: "gemini-2.5-flash"` and
   `config: { responseMimeType: "application/json", responseSchema }` to force
   structured output, mirroring the Anthropic client's forced-schema approach.

3. **Provider toggle in `knowledgeGraphIndex.ts`.** Reads
   `KG_EXTRACTION_PROVIDER` (`"gemini"` | `"anthropic"`) and constructs the
   matching client. Throws immediately on an unset or unrecognized value —
   no silent default, since picking the wrong provider silently would waste
   a live test the same way the credit-balance error did.

4. **Env vars.** `.env` and `.env.example` gain `GEMINI_API_KEY` and
   `KG_EXTRACTION_PROVIDER=gemini` (the new default posture until funding
   changes). `ANTHROPIC_API_KEY` stays as-is for the future switch-back.

5. **`package.json`.** Add `@google/genai@^2.12.0` (current published
   version, confirmed via `npm view` on 2026-07-21).

6. **Docs.** `CLAUDE.md` gains a short note next to the existing
   "Real vs. fake adapters" section explaining the Gemini client and the
   toggle. `ROADMAP.md`'s Knowledge Graph Builder section notes the billing
   blocker and its resolution.

## Retrying live verification

No need for a new live meeting — the real transcript from the 2026-07-21 test
("We designed it to ship the new feature next Friday.") is already persisted
in Postgres for meeting `falcon-meet`. Once this is wired, deleting the
`failed` `graph_builds` row for that meeting lets `KnowledgeGraphWorker` pick
it up again on its next poll, this time through Gemini.

## Testing

- Update `decisionExtractor.test.ts`'s reference to the renamed type
  (mechanical; no test behavior changes).
- Full suite re-run after the rename to catch any other reference to the old
  interface name.
- `realGeminiExtractionClient.ts` and the `knowledgeGraphIndex.ts` provider
  branch are not unit tested (see Non-goals) — verified live instead, via the
  retry described above.
