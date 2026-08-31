import { NextResponse } from 'next/server';
import { captureException } from '@falcon/observability';
import { getActiveSession } from '@/lib/session';
import { PairingError, leaveSession } from '@/lib/pairing';

export const runtime = 'nodejs';

/** POST /api/session/{id}/leave — graceful leave (agent teardown + visibility recompute land in US2). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    await leaveSession(s, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof PairingError) return NextResponse.json({ error: e.message }, { status: e.status });
    captureException(e, { route: 'session/[id]/leave', userId: s.userId });
    return NextResponse.json({ error: 'session service unavailable' }, { status: 503 });
  }
}
