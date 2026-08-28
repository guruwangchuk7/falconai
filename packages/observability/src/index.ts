/**
 * Dependency-light observability (T014). Sentry (@sentry/node) and PostHog (posthog-node) are
 * loaded ONLY when their env keys are present — so dev + CI run with zero extra deps and every
 * call no-ops safely. Install the SDKs where they're actually used (web/worker prod images).
 *
 * The `: string` annotations are deliberate: they stop TypeScript from statically resolving the
 * dynamic-import specifiers, so this typechecks without the SDKs installed.
 */

const SENTRY_PKG: string = '@sentry/node';
const POSTHOG_PKG: string = 'posthog-node';

let sentry: any = null;
let posthog: any = null;

/** Idempotent. Call once at process/server start (worker index, web instrumentation). */
export async function initObservability(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (dsn && !sentry) {
    try {
      sentry = await import(SENTRY_PKG);
      sentry.init({ dsn, tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1') });
    } catch {
      console.warn('SENTRY_DSN set but @sentry/node is not installed — skipping Sentry.');
      sentry = null;
    }
  }
  const key = process.env.POSTHOG_KEY;
  if (key && !posthog) {
    try {
      const mod = await import(POSTHOG_PKG);
      posthog = new mod.PostHog(key, { host: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com' });
    } catch {
      console.warn('POSTHOG_KEY set but posthog-node is not installed — skipping PostHog.');
      posthog = null;
    }
  }
}

/** Report an error to Sentry if configured; always logs so nothing is swallowed. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (sentry) sentry.captureException(err, context ? { extra: context } : undefined);
  else console.error('[observability] captureException:', err, context ?? '');
}

/** Server-side product event to PostHog if configured; no-op otherwise. */
export function captureEvent(distinctId: string, event: string, properties?: Record<string, unknown>): void {
  if (posthog) posthog.capture({ distinctId, event, ...(properties ? { properties } : {}) });
}

/** Flush buffered events before shutdown so nothing is lost on exit. */
export async function flushObservability(): Promise<void> {
  try {
    await sentry?.flush?.(2000);
  } catch {
    /* best-effort */
  }
  try {
    await posthog?.shutdown?.();
  } catch {
    /* best-effort */
  }
}
