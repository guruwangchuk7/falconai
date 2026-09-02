import { z } from 'zod';

/**
 * Central, fail-fast environment schema. Every service validates its slice at boot so a missing
 * or blank secret is a startup error, not a silent runtime failure (constitution IV).
 * Import the narrow schema you need (web vs worker) rather than requiring everything everywhere.
 */

const nonEmpty = z.string().min(1);

export const dbEnv = z.object({
  // Supabase TRANSACTION-mode pooler (port 6543) — withTenant depends on it.
  DATABASE_URL: nonEmpty,
});

export const redisEnv = z.object({
  REDIS_URL: nonEmpty,
});

export const llmEnv = z.object({
  ANTHROPIC_API_KEY: nonEmpty,
  VOYAGE_API_KEY: nonEmpty,
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().url().optional(),
});

export const secretsEnv = z.object({
  // Dedicated secrets store (NOT the app DB — R26). KEK for envelope encryption of tokens.
  SECRETS_KEK: nonEmpty, // 32-byte key, base64
  SECRETS_BACKEND: z.enum(['file', 'infisical']).default('file'),
  SECRETS_FILE_PATH: z.string().optional(), // dev file backend, kept OUTSIDE the app DB
  INFISICAL_URL: z.string().url().optional(),
  INFISICAL_TOKEN: z.string().optional(),
});

export const githubEnv = z.object({
  GITHUB_APP_ID: nonEmpty,
  GITHUB_APP_PRIVATE_KEY: nonEmpty,
  GITHUB_WEBHOOK_SECRET: nonEmpty,
  GITHUB_APP_SLUG: z.string().optional(), // for the install redirect (connect flow)
});

export const linearEnv = z.object({
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
  LINEAR_WEBHOOK_SECRET: z.string().optional(), // HMAC signing secret for /api/webhooks/linear
});

export const authEnv = z.object({
  AUTH_SECRET: nonEmpty,
});

export const sttEnv = z.object({
  // Deepgram Nova streaming STT (primary). AssemblyAI failover key optional.
  DEEPGRAM_API_KEY: nonEmpty,
  ASSEMBLYAI_API_KEY: z.string().optional(),
});

/** Parse a schema against process.env, throwing a readable aggregate error on failure. */
export function loadEnv<T extends z.ZodTypeAny>(schema: T, source: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const DEFAULT_FRESHNESS_HORIZON_DAYS = 180;
export const ROLLING_WINDOW_DAYS = 30;

/**
 * Decision Memory (feature 005, research.md R1). Maximum cosine DISTANCE (`<=>`, range [0,2];
 * 0 = identical) at which a decision is considered relevant to a question. Used to (a) decide
 * whether an UNCONFIRMED candidate is surfaced as answer status metadata (US2), and optionally
 * (b) guard confirmed decision search against small-corpus false positives.
 *
 * PROVISIONAL default — conservative (surface only very close matches). This value MUST be
 * calibrated on a seeded corpus via `packages/evals/src/decision-ceiling.ts` (task T002) before
 * US2 ships; it is intentionally strict until then so noise is preferred-absent over
 * preferred-present. Do not loosen without calibration evidence.
 */
export const DECISION_RELEVANCE_MAX_DISTANCE = 0.45;

/**
 * Ship 2 (decision miner, spec §7) — PROVISIONAL until shadow-calibration. Conservative defaults:
 * a high suggest-time confidence cutoff and a small daily suggestion budget so the miner errs
 * toward silence rather than noise while its precision is unproven on real corpora.
 */
export const DECISION_MINE_MIN_CONFIDENCE = 0.75; // suggest-time cutoff on ScoredCandidate.score
export const DECISION_MINE_DAILY_BUDGET = 10;     // max suggestions/workspace/day (flood guard)

/**
 * In-Meeting Decision Listener (feature 005 / post-meeting capture). PROVISIONAL — the confidence
 * cutoff MUST be calibrated on a labeled MEETING corpus (spoken/disfluent input is harder than PRs)
 * before the listener enforces, mirroring Ship 2's shadow discipline. Strict until then.
 */
export const DECISION_MEETING_MIN_CONFIDENCE = 0.75; // suggest-time cutoff on candidate.score
export const MEETING_RATIONALE_PASS_TOP_N = 3;       // cap the targeted rationale pass (cost lever, spec §13)
export const MEETING_WORKING_COPY_TTL_HOURS = 48;    // durable working-copy TTL, in [24,72] (D7)
export const MEETING_REVIEWER_ESCALATION_HOURS = 36; // reviewer inaction → notify all attendees (spec §7)
export const MEETING_IDLE_GRACE_MS = 120_000;      // reconnect window before idle-disconnect ends a meeting (D8)
export const MEETING_MAX_SESSION_MS = 4 * 3_600_000; // hard cap so a forgotten-open tab can't run forever (D8)
export const DECISION_MEETING_DAILY_BUDGET = 20; // reserved meeting suggestion lane/day (D11) — separate from the PR miner's
export const MEETING_CHUNK_SIZE = 40;            // utterances per extraction chunk (cost lever, §13)
