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
});

export const authEnv = z.object({
  AUTH_SECRET: nonEmpty,
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
