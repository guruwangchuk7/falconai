import { NextResponse } from 'next/server';
import { captureException } from '@falcon/observability';
import { getActiveSession } from '@/lib/session';
import { PairingError, recordConsent } from '@/lib/pairing';

export const runtime = 'nodejs';

/** POST /api/consent/pair — record once-per-pair consent (§7.2). Internal pairs are remembered;
 *  cross-workspace pairs are flagged so they always re-prompt. */
export async function POST(req: Request) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { otherUserId?: string; granted?: boolean; isCrossWorkspace?: boolean };
  const other = body.otherUserId?.trim();
  if (!other || typeof body.granted !== 'boolean') {
    return NextResponse.json({ error: 'otherUserId and granted required' }, { status: 400 });
  }
  try {
    await recordConsent(s, other, body.granted, body.isCrossWorkspace ?? false);
    return NextResponse.json({ consentState: body.granted ? 'granted' : 'revoked' });
  } catch (e) {
    if (e instanceof PairingError) return NextResponse.json({ error: e.message }, { status: e.status });
    captureException(e, { route: 'consent/pair', userId: s.userId });
    return NextResponse.json({ error: 'consent service unavailable' }, { status: 503 });
  }
}
