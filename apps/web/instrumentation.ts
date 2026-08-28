/** Next.js runs this once at server startup. Initialize observability here so Sentry/PostHog are
 *  ready before the first request (no-ops unless SENTRY_DSN / POSTHOG_KEY are set). */
export async function register(): Promise<void> {
  const { initObservability } = await import('@falcon/observability');
  await initObservability();
}
