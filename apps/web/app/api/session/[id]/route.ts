import { NextResponse } from 'next/server';
import { captureException } from '@falcon/observability';
import { getActiveSession } from '@/lib/session';
import { PairingError, getSessionView } from '@/lib/pairing';

export const runtime = 'nodejs';

/** GET /api/session/{id} — session metadata + current membership (no transcript; that's the SSE
 *  stream). 404 for non-members and cross-tenant ids (RLS makes another tenant's session invisible). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json(await getSessionView(s, id));
  } catch (e) {
    if (e instanceof PairingError) return NextResponse.json({ error: e.message }, { status: e.status });
    captureException(e, { route: 'session/[id]', userId: s.userId });
    return NextResponse.json({ error: 'session service unavailable' }, { status: 503 });
  }
}
