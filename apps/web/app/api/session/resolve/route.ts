import { NextResponse } from 'next/server';
import { rateLimit } from '@falcon/queue';
import { captureException } from '@falcon/observability';
import { getActiveSession } from '@/lib/session';
import { PairingError, resolveByCalendar } from '@/lib/pairing';

export const runtime = 'nodejs';

/** POST /api/session/resolve — resolve or create the session for a calendar event (F7.1) and join
 *  it. Two people in the same invite land in the same session automatically. */
export async function POST(req: Request) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await rateLimit(`session-resolve:${s.userId}`, 30, 60)).ok) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { calendarEventId?: string };
  const cal = body.calendarEventId?.trim();
  if (!cal) return NextResponse.json({ error: 'calendarEventId required' }, { status: 400 });
  try {
    return NextResponse.json(await resolveByCalendar(s, cal));
  } catch (e) {
    if (e instanceof PairingError) return NextResponse.json({ error: e.message }, { status: e.status });
    captureException(e, { route: 'session/resolve', userId: s.userId });
    return NextResponse.json({ error: 'session service unavailable' }, { status: 503 });
  }
}
