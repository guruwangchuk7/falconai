import { NextResponse } from 'next/server';
import { captureException } from '@falcon/observability';
import { getActiveSession } from '@/lib/session';
import { PairingError, recordConsent } from '@/lib/pairing';

export const runtime = 'nodejs';

/** DELETE /api/consent/pair/{otherUserId} — revoke consent; future sessions with this pair re-prompt. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ otherUserId: string }> }) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { otherUserId } = await params;
  try {
    await recordConsent(s, otherUserId, false);
    return NextResponse.json({ consentState: 'revoked' });
  } catch (e) {
    if (e instanceof PairingError) return NextResponse.json({ error: e.message }, { status: e.status });
    captureException(e, { route: 'consent/pair/[otherUserId]', userId: s.userId });
    return NextResponse.json({ error: 'consent service unavailable' }, { status: 503 });
  }
}
