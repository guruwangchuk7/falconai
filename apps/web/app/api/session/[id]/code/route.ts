import { NextResponse } from 'next/server';
import { rateLimit } from '@falcon/queue';
import { captureException } from '@falcon/observability';
import { getActiveSession } from '@/lib/session';
import { PairingError, mintCode } from '@/lib/pairing';

export const runtime = 'nodejs';

/** POST /api/session/{id}/code — mint a share code with TTL + rate/scope (F7.3). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await rateLimit(`session-code:${s.userId}`, 10, 60)).ok) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }
  try {
    return NextResponse.json(await mintCode(s, id));
  } catch (e) {
    if (e instanceof PairingError) return NextResponse.json({ error: e.message }, { status: e.status });
    captureException(e, { route: 'session/[id]/code', userId: s.userId });
    return NextResponse.json({ error: 'session service unavailable' }, { status: 503 });
  }
}
