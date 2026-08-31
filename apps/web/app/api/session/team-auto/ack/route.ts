import { NextResponse } from 'next/server';
import { captureException } from '@falcon/observability';
import { getActiveSession } from '@/lib/session';
import { PairingError, ackTeamAuto } from '@/lib/pairing';

export const runtime = 'nodejs';

/** POST /api/session/team-auto/ack — accept a same-workspace auto-pair prompt (F7.2). */
export async function POST(req: Request) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { candidateSessionId?: string };
  const cand = body.candidateSessionId?.trim();
  if (!cand) return NextResponse.json({ error: 'candidateSessionId required' }, { status: 400 });
  try {
    return NextResponse.json(await ackTeamAuto(s, cand));
  } catch (e) {
    if (e instanceof PairingError) return NextResponse.json({ error: e.message }, { status: e.status });
    captureException(e, { route: 'session/team-auto/ack', userId: s.userId });
    return NextResponse.json({ error: 'session service unavailable' }, { status: 503 });
  }
}
