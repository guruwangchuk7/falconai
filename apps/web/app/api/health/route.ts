// Liveness probe for Fly.io health checks (see fly.pilot.toml). Pure liveness — no DB or secret
// access — so a healthy machine reports up even while a dependency is briefly degraded (readiness is
// handled per-request by the app's honest-degradation states, Constitution IV).
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok', service: 'falcon-pilot', time: new Date().toISOString() });
}
