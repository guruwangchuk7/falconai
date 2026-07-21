# Gemini Extraction Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Knowledge Graph Builder a working, zero-cost real extraction client (Gemini) while keeping the existing Anthropic client selectable, so switching back once funded is a one-line env change.

**Architecture:** `DecisionExtractor` already depends only on a narrow interface (`extract(text): Promise<ExtractionResult>`), so this is an adapter swap: rename that interface to be provider-neutral, add a Gemini implementation alongside the existing Anthropic one, and pick between them in the composition root via an env var.

**Tech Stack:** TypeScript, `@google/genai` (new dependency), existing `@anthropic-ai/sdk`, vitest.

## Global Constraints

- `@google/genai@^2.12.0` — current published version, confirmed via `npm view @google/genai version` on 2026-07-21.
- Gemini model: `gemini-2.5-flash`.
- Interface name: `ExtractionClientLike` (renamed from `AnthropicExtractionClientLike`).
- `KG_EXTRACTION_PROVIDER` accepts only `"gemini"` or `"anthropic"` — throw immediately on unset/unrecognized, no silent default.
- Real adapters (`realGeminiExtractionClient.ts`, matching `realAnthropicExtractionClient.ts`) are not unit tested — this repo's established convention for code needing live credentials (see CLAUDE.md's "Real vs. fake adapters"). Verified live instead, in the final task.
- `package.json`'s `dependencies` block is alphabetically ordered — preserve that when inserting `@google/genai`.

---

### Task 1: Rename `AnthropicExtractionClientLike` → `ExtractionClientLike`

**Files:**
- Modify: `src/knowledgeGraph/decisionExtractor.types.ts`
- Modify: `src/knowledgeGraph/decisionExtractor.ts`
- Modify: `src/knowledgeGraph/realAnthropicExtractionClient.ts`

**Interfaces:**
- Produces: `ExtractionClientLike` (same shape as the old `AnthropicExtractionClientLike` — `{ extract(transcriptText: string): Promise<ExtractionResult> }`), used by Task 3 and Task 4.

- [ ] **Step 1: Rename the interface in `decisionExtractor.types.ts`**

Current content of that file:
```typescript
import type { ExtractionResult } from "./knowledgeGraph.types";

export interface AnthropicExtractionClientLike {
  extract(transcriptText: string): Promise<ExtractionResult>;
}
```

Change it to:
```typescript
import type { ExtractionResult } from "./knowledgeGraph.types";

export interface ExtractionClientLike {
  extract(transcriptText: string): Promise<ExtractionResult>;
}
```

- [ ] **Step 2: Update `decisionExtractor.ts`'s import and usage**

Current content:
```typescript
import type { AnthropicExtractionClientLike } from "./decisionExtractor.types";
import type { ExtractionResult } from "./knowledgeGraph.types";

export class DecisionExtractor {
  constructor(private readonly client: AnthropicExtractionClientLike) {}
```

Change the two `AnthropicExtractionClientLike` occurrences to `ExtractionClientLike`:
```typescript
import type { ExtractionClientLike } from "./decisionExtractor.types";
import type { ExtractionResult } from "./knowledgeGraph.types";

export class DecisionExtractor {
  constructor(private readonly client: ExtractionClientLike) {}
```

- [ ] **Step 3: Update `realAnthropicExtractionClient.ts`'s import and usage**

Change:
```typescript
import type { AnthropicExtractionClientLike } from "./decisionExtractor.types";
```
to:
```typescript
import type { ExtractionClientLike } from "./decisionExtractor.types";
```

And change:
```typescript
export function createRealAnthropicExtractionClient(apiKey: string): AnthropicExtractionClientLike {
```
to:
```typescript
export function createRealAnthropicExtractionClient(apiKey: string): ExtractionClientLike {
```

- [ ] **Step 4: Confirm no remaining references to the old name**

Run: `grep -rn "AnthropicExtractionClientLike" --include="*.ts" .`
Expected: no output (zero matches).

- [ ] **Step 5: Run the existing unit test to confirm the rename didn't break anything**

Run: `npx vitest run tests/unit/decisionExtractor.test.ts`
Expected: `2 passed` (this test uses a plain object fake, not the type name, so it should be unaffected — this run just confirms that).

- [ ] **Step 6: Run the full build to type-check every reference**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/knowledgeGraph/decisionExtractor.types.ts src/knowledgeGraph/decisionExtractor.ts src/knowledgeGraph/realAnthropicExtractionClient.ts
git commit -m "Rename AnthropicExtractionClientLike to ExtractionClientLike

The interface is provider-neutral (extract(text) -> ExtractionResult);
the old name stopped being accurate once a Gemini implementation was
about to satisfy it too."
```

---

### Task 2: Add the `@google/genai` dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (via `npm install`)

**Interfaces:**
- Produces: the installed `@google/genai` package, consumed by Task 3.

- [ ] **Step 1: Add the dependency to `package.json`**

In the `dependencies` block, insert `@google/genai` alphabetically right after `@anthropic-ai/sdk`:
```json
  "dependencies": {
    "@anthropic-ai/sdk": "^0.112.3",
    "@google/genai": "^2.12.0",
    "@livekit/rtc-node": "^0.13.31",
    "@zoom/rtms": "^1.1.0",
    "dotenv": "^17.4.2",
    "livekit-server-sdk": "^2.17.0",
    "pg": "^8.22.0",
    "redis": "^6.1.0",
    "ws": "^8.21.1"
  },
```

- [ ] **Step 2: Install it**

Run: `npm install`
Expected: exits 0; `package-lock.json` gains `@google/genai` and its transitive deps.

- [ ] **Step 3: Confirm it resolves**

Run: `node -e "console.log(typeof require('@google/genai').GoogleGenAI)"`
Expected: `function`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add @google/genai dependency for the Gemini extraction client"
```

---

### Task 3: Implement `realGeminiExtractionClient.ts`

**Files:**
- Create: `src/knowledgeGraph/realGeminiExtractionClient.ts`

**Interfaces:**
- Consumes: `ExtractionClientLike`, `ExtractionResult` (from Task 1's `decisionExtractor.types.ts` / existing `knowledgeGraph.types.ts`); `GoogleGenAI` from `@google/genai` (Task 2).
- Produces: `createRealGeminiExtractionClient(apiKey: string): ExtractionClientLike`, consumed by Task 4.

- [ ] **Step 1: Write the file**

```typescript
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
```

- [ ] **Step 2: Type-check it**

Run: `npm run build`
Expected: no TypeScript errors (confirms `ExtractionClientLike` is satisfied and `@google/genai`'s types resolve).

- [ ] **Step 3: No unit test for this file**

Per the Global Constraints and this repo's established "real adapter" convention (`realAnthropicExtractionClient.ts`, `realRtmsClient.ts`, `realLiveKitRoom.ts` are all excluded from unit coverage — they need live credentials). This file is verified live in Task 6.

- [ ] **Step 4: Commit**

```bash
git add src/knowledgeGraph/realGeminiExtractionClient.ts
git commit -m "Add realGeminiExtractionClient.ts

Same shape as realAnthropicExtractionClient.ts: forces structured JSON
output via Gemini's responseSchema config, own copy of the extraction
prompt (not shared -- each real adapter in this repo is self-contained)."
```

---

### Task 4: Wire the provider toggle + env files

**Files:**
- Modify: `src/server/knowledgeGraphIndex.ts`
- Modify: `.env` (local file, not committed — already gitignored)
- Modify: `.env.example`

**Interfaces:**
- Consumes: `createRealGeminiExtractionClient` (Task 3), `createRealAnthropicExtractionClient` (Task 1), `ExtractionClientLike` (Task 1).

- [ ] **Step 1: Rewrite `knowledgeGraphIndex.ts` with the provider branch**

Current content:
```typescript
import "dotenv/config";
import { KnowledgeGraphWorker } from "../knowledgeGraph/knowledgeGraphWorker";
import { GraphBuildStore } from "../knowledgeGraph/graphBuildStore";
import { TranscriptFetcher } from "../knowledgeGraph/transcriptFetcher";
import { DecisionExtractor } from "../knowledgeGraph/decisionExtractor";
import { createRealAnthropicExtractionClient } from "../knowledgeGraph/realAnthropicExtractionClient";
import { GraphWriter } from "../knowledgeGraph/graphWriter";

async function startKnowledgeGraphWorker(): Promise<void> {
  const worker = new KnowledgeGraphWorker({
    buildStore: new GraphBuildStore(),
    fetcher: new TranscriptFetcher(),
    extractor: new DecisionExtractor(
      createRealAnthropicExtractionClient(process.env.ANTHROPIC_API_KEY!)
    ),
    writer: new GraphWriter(),
    onAlert: (message, err) => console.error(message, err),
    pollIntervalMs: Number(process.env.KG_POLL_INTERVAL_MS ?? 5000),
  });

  console.log("Knowledge Graph worker started, polling for ended meetings...");
  await worker.start();
}

startKnowledgeGraphWorker().catch((err) => {
  console.error("failed to start Knowledge Graph worker", err);
  process.exit(1);
});
```

Replace it entirely with:
```typescript
import "dotenv/config";
import { KnowledgeGraphWorker } from "../knowledgeGraph/knowledgeGraphWorker";
import { GraphBuildStore } from "../knowledgeGraph/graphBuildStore";
import { TranscriptFetcher } from "../knowledgeGraph/transcriptFetcher";
import { DecisionExtractor } from "../knowledgeGraph/decisionExtractor";
import { createRealAnthropicExtractionClient } from "../knowledgeGraph/realAnthropicExtractionClient";
import { createRealGeminiExtractionClient } from "../knowledgeGraph/realGeminiExtractionClient";
import { GraphWriter } from "../knowledgeGraph/graphWriter";
import type { ExtractionClientLike } from "../knowledgeGraph/decisionExtractor.types";

function createExtractionClient(): ExtractionClientLike {
  const provider = process.env.KG_EXTRACTION_PROVIDER;
  if (provider === "gemini") {
    return createRealGeminiExtractionClient(process.env.GEMINI_API_KEY!);
  }
  if (provider === "anthropic") {
    return createRealAnthropicExtractionClient(process.env.ANTHROPIC_API_KEY!);
  }
  throw new Error(
    `KG_EXTRACTION_PROVIDER must be "gemini" or "anthropic", got: ${JSON.stringify(provider)}`
  );
}

async function startKnowledgeGraphWorker(): Promise<void> {
  const worker = new KnowledgeGraphWorker({
    buildStore: new GraphBuildStore(),
    fetcher: new TranscriptFetcher(),
    extractor: new DecisionExtractor(createExtractionClient()),
    writer: new GraphWriter(),
    onAlert: (message, err) => console.error(message, err),
    pollIntervalMs: Number(process.env.KG_POLL_INTERVAL_MS ?? 5000),
  });

  console.log("Knowledge Graph worker started, polling for ended meetings...");
  await worker.start();
}

startKnowledgeGraphWorker().catch((err) => {
  console.error("failed to start Knowledge Graph worker", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the new vars to `.env`**

`.env` already has `ANTHROPIC_API_KEY` filled in. Append these two lines (the Gemini key is the one already provided earlier in this session):
```
GEMINI_API_KEY=<the Gemini API key>
KG_EXTRACTION_PROVIDER=gemini
```

- [ ] **Step 3: Add the same vars (blank/default) to `.env.example`**

Current content ends with:
```
ANTHROPIC_API_KEY=
KG_POLL_INTERVAL_MS=5000
```

Change to:
```
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
KG_EXTRACTION_PROVIDER=gemini
KG_POLL_INTERVAL_MS=5000
```

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 5: Manually verify the throw-on-invalid-provider behavior**

Temporarily set an invalid value in `.env`, run `npm run dev:kg`, observe the crash, then restore `.env`:

```bash
# Temporarily break it
sed -i 's/KG_EXTRACTION_PROVIDER=gemini/KG_EXTRACTION_PROVIDER=bogus/' .env
npm run dev:kg
```
Expected: process exits immediately with `failed to start Knowledge Graph worker Error: KG_EXTRACTION_PROVIDER must be "gemini" or "anthropic", got: "bogus"`.

```bash
# Restore it
sed -i 's/KG_EXTRACTION_PROVIDER=bogus/KG_EXTRACTION_PROVIDER=gemini/' .env
```

- [ ] **Step 6: Commit (excluding `.env`, which is gitignored)**

```bash
git add src/server/knowledgeGraphIndex.ts .env.example
git commit -m "Add KG_EXTRACTION_PROVIDER toggle between Gemini and Anthropic

Defaults to no default -- throws immediately on an unset or
unrecognized value, since silently picking a provider would waste a
live test the same way the Anthropic credit-balance error already did."
```

---

### Task 5: Update `CLAUDE.md` and `ROADMAP.md`

**Files:**
- Modify: `CLAUDE.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Update `CLAUDE.md`'s `realAnthropicExtractionClient.ts` bullet**

Find this paragraph (in the Knowledge Graph Builder section):
```
- **`realAnthropicExtractionClient.ts`** (`src/knowledgeGraph/realAnthropicExtractionClient.ts`) — wraps `@anthropic-ai/sdk`, forcing structured JSON output via `output_config.format` against a fixed schema (never free-text parsing). Follows this repo's "real adapter" convention (see "Real vs. fake adapters" above): deliberately excluded from unit-test coverage, needs a live API key. `DecisionExtractor` (`decisionExtractor.ts`) is the thin, unit-tested wrapper around whatever `AnthropicExtractionClientLike` it's given.
```

Replace with:
```
- **Two interchangeable real extraction clients**, both implementing `ExtractionClientLike` (`{ extract(text): Promise<ExtractionResult> }`, in `decisionExtractor.types.ts` — renamed from `AnthropicExtractionClientLike` once a second provider existed): `realAnthropicExtractionClient.ts` wraps `@anthropic-ai/sdk`, forcing structured JSON output via `output_config.format` against a fixed schema; `realGeminiExtractionClient.ts` wraps `@google/genai`'s `generateContent()`, forcing structured output via `responseSchema` (its schema dialect has no `additionalProperties`, unlike Anthropic's, so that field is simply omitted — the two schemas are not shared code). Both follow this repo's "real adapter" convention (see "Real vs. fake adapters" above): deliberately excluded from unit-test coverage, need a live API key. `src/server/knowledgeGraphIndex.ts` picks between them via `KG_EXTRACTION_PROVIDER` (`"gemini"` | `"anthropic"`, no default — throws on anything else). **Currently defaulted to Gemini in `.env`**: the account has zero funding as of 2026-07-21 and Anthropic's real API returned `"Your credit balance is too low to access the Anthropic API"` on the first live call. Gemini's free tier unblocks live verification now; flipping back to `anthropic` once funded needs nothing but that one env var (and a funded `ANTHROPIC_API_KEY`). `DecisionExtractor` (`decisionExtractor.ts`) is the thin, unit-tested wrapper around whichever client it's given.
```

- [ ] **Step 2: Update `CLAUDE.md`'s "Not yet verified" line**

Find:
```
**Not yet verified**: the real `realAnthropicExtractionClient.ts` against a live Claude API call, and the full pipeline end-to-end against a real LiveKit meeting (`npm run dev:livekit` + `npm run dev:kg` together, confirming real spoken decisions and speaker attribution land correctly in `graph_nodes`/`graph_edges`) — see `ROADMAP.md`'s "Next steps" for the exact manual verification procedure.
```

Replace with:
```
**Not yet verified**: the real `realGeminiExtractionClient.ts` (now the default provider) against a live Gemini API call, and the full pipeline end-to-end against a real LiveKit meeting (`npm run dev:livekit` + `npm run dev:kg` together, confirming real spoken decisions and speaker attribution land correctly in `graph_nodes`/`graph_edges`). `realAnthropicExtractionClient.ts` did reach a live Claude API call once (2026-07-21) and got a credit-balance error, not a code-path result — still practically unverified. See `ROADMAP.md`'s "Next steps" for the exact manual verification procedure.
```

- [ ] **Step 3: Update `ROADMAP.md`'s "Next steps" section**

Find item 2 and 3 in the numbered list at the top of `ROADMAP.md`:
```
2. **Restore `.env`** — it's stale (dated Jul 16) and missing keys that used to be there:
   - `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` (project `falcon-ai-vzhdw96i.livekit.cloud`) — re-copy from wherever you originally got them (LiveKit Cloud dashboard → your project → Settings → Keys).
   - `ANTHROPIC_API_KEY` — new, needed for the Knowledge Graph worker's real Claude calls. Get one from console.anthropic.com if you don't have one handy.
   - `KG_POLL_INTERVAL_MS=5000` (optional, defaults to 5000 anyway).
3. **Run the manual/live verification** (the one remaining step of the Knowledge Graph Builder plan):
```

Replace with:
```
2. ~~**Restore `.env`**~~ — done (2026-07-21): `LIVEKIT_API_KEY`/`SECRET`/`URL` and `ANTHROPIC_API_KEY` were already present. Since then, `KG_EXTRACTION_PROVIDER=gemini` and `GEMINI_API_KEY` were added too — the Knowledge Graph worker now defaults to Gemini's free tier (zero funding as of this date; Anthropic's real API returned a credit-balance error on first live call). Flip `KG_EXTRACTION_PROVIDER` to `anthropic` once funded.
3. **Run the manual/live verification** (the one remaining step of the Knowledge Graph Builder plan):
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md ROADMAP.md
git commit -m "Document the Gemini/Anthropic extraction provider toggle"
```

---

### Task 6: Retry live verification through Gemini

No new meeting needed — the real transcript from the 2026-07-21 test ("We designed it to ship the new feature next Friday.") is already in Postgres for meeting `falcon-meet`, and its prior `graph_builds` row is `status='failed'` with the Anthropic credit-balance error.

**Files:** none (this is a live infra/verification task, not a code change).

- [ ] **Step 1: Confirm Postgres and Redis are reachable, and load `DATABASE_URL` into the shell**

Run: `pg_isready -h localhost -p 5432 && redis-cli -h localhost -p 6379 ping`
Expected: `localhost:5432 - accepting connections` and `PONG`. If not, start them per `ROADMAP.md`'s "Next steps" item 1.

The remaining steps in this task use `psql "$DATABASE_URL"` — export it from `.env` first:
```bash
export DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
```

- [ ] **Step 2: Confirm `.env` has the new vars from Task 4**

Run: `grep -E "GEMINI_API_KEY|KG_EXTRACTION_PROVIDER" .env`
Expected: `GEMINI_API_KEY=<a real key>` and `KG_EXTRACTION_PROVIDER=gemini`.

- [ ] **Step 3: Delete the stale failed build row so the worker retries it**

Run:
```bash
psql "$DATABASE_URL" -c "DELETE FROM graph_builds WHERE meeting_id='falcon-meet';"
```
Expected: `DELETE 1`.

- [ ] **Step 4: Start (or restart) the Knowledge Graph worker with the new code**

If `npm run dev:kg` is already running from an earlier session, it's running old in-memory code (from before Task 4's rewrite) and won't pick up the provider toggle. Find and stop it first:
```bash
# Windows (Git Bash): find the tsx process running knowledgeGraphIndex.ts
ps aux | grep "knowledgeGraphIndex" | grep -v grep
# kill <PID> from that output, then start fresh
npm run dev:kg
```
Expected startup log: `Knowledge Graph worker started, polling for ended meetings...`

- [ ] **Step 5: Wait one poll interval, then check the build status**

Run (after ~5-10 seconds, matching `KG_POLL_INTERVAL_MS`):
```bash
psql "$DATABASE_URL" -c "SELECT meeting_id, status, error FROM graph_builds WHERE meeting_id='falcon-meet';"
```
Expected: `status = completed`, `error` empty. If `status = failed` again, read the `error` column — it will contain the real Gemini error message (e.g. an invalid API key or model name), which is the next thing to fix.

- [ ] **Step 6: Confirm the real decision landed, scoped through the meeting's own edge**

Run (per CLAUDE.md's documented gotcha, scope through `MADE_IN` rather than an unscoped `graph_nodes` query, since this shared dev database has other meetings' decision nodes too):
```bash
psql "$DATABASE_URL" -c "
SELECT d.label
FROM graph_nodes m
JOIN graph_edges e ON e.to_node_id = m.id AND e.type = 'MADE_IN'
JOIN graph_nodes d ON d.id = e.from_node_id
WHERE m.type = 'meeting' AND m.natural_key = 'falcon-meet'
ORDER BY d.created_at DESC LIMIT 5;
"
```
Expected: a row whose `label` reflects the real spoken decision (something to the effect of shipping the new feature next Friday).

- [ ] **Step 7: Confirm speaker attribution**

Run:
```bash
psql "$DATABASE_URL" -c "
SELECT p.label AS person, d.label AS decision
FROM graph_edges e
JOIN graph_nodes p ON p.id = e.from_node_id AND p.type = 'person'
JOIN graph_nodes d ON d.id = e.to_node_id AND d.type = 'decision'
JOIN graph_edges made_in ON made_in.from_node_id = d.id AND made_in.type = 'MADE_IN'
JOIN graph_nodes m ON m.id = made_in.to_node_id AND m.natural_key = 'falcon-meet'
WHERE e.type = 'MADE';
"
```
Expected: a row with `person = Guru Wangchuk` and `decision` matching the text from Step 6.

- [ ] **Step 8: Update `CLAUDE.md` and `ROADMAP.md` with the actual result**

If Steps 5-7 succeeded, update `CLAUDE.md`'s "Not yet verified" line (edited in Task 5) to move this to "Verified" with the date and a one-line summary of the real decision text/speaker, matching the style of the existing "Verified via automated tests only" paragraph. Update `ROADMAP.md`'s Knowledge Graph Builder section similarly (matching the style of its existing "Task 11 fully closed" writeups elsewhere in the file).

If Step 5 showed a new `failed` status, do not edit the docs to claim success — instead record the actual Gemini error message in a new dated note in `ROADMAP.md`'s "Next steps", the same way the Anthropic credit-balance error was recorded, and treat fixing that as the next task.

- [ ] **Step 9: Commit the doc updates**

```bash
git add CLAUDE.md ROADMAP.md
git commit -m "Record live verification result for the Gemini extraction client"
```
