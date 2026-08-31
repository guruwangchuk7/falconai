import { NextResponse } from 'next/server';
import { rateLimit } from '@falcon/queue';
import { captureException } from '@falcon/observability';
import { getActiveSession } from '@/lib/session';
import { PairingError, joinByCode } from '@/lib/pairing';

export const runtime = 'nodejs';

/** POST /api/session/join-by-code — fallback join via a 6-char code (F7.3). TTL / max-joins / scope
 *  are enforced so a leaked code is bounded (404 unknown · 410 expired · 429 over-limit). */
export async function POST(req: Request) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await rateLimit(`session-join:${s.userId}`, 20, 60)).ok) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const code = body.code?.trim().toUpperCase();
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 });
  try {
    return NextResponse.json(await joinByCode(s, code));
  } catch (e) {
    if (e instanceof PairingError) return NextResponse.json({ error: e.message }, { status: e.status });
    captureException(e, { route: 'session/join-by-code', userId: s.userId });
    return NextResponse.json({ error: 'session service unavailable' }, { status: 503 });
  }
}
