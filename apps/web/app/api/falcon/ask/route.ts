import { NextResponse } from 'next/server';
import { rateLimit } from '@falcon/queue';
import { getActiveSession } from '@/lib/session';
import { runFalconTurn } from '@/lib/falcon';

export const runtime = 'nodejs';

/** POST /api/falcon/ask — grounded personal Q&A (spec 002-personal-falcon, US1/FR-001..005).
 *  Grounding gate lives in the answer core (Constitution II); the turn + citations + retention
 *  event are persisted tenant-scoped by runFalconTurn. */
export async function POST(req: Request) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!(await rateLimit(`falcon-ask:${s.userId}`, 30, 60)).ok) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  const body = (await req.json()) as { question?: string; conversationId?: string };
  const questionText = body.question?.trim();
  if (!questionText) return NextResponse.json({ error: 'question required' }, { status: 400 });

  try {
    const result = await runFalconTurn(s, questionText, 'qa', body.conversationId);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: 'Falcon is temporarily unavailable — try again in a moment.' },
      { status: 503 },
    );
  }
}
