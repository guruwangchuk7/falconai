import { NextResponse } from 'next/server';
import { rateLimit } from '@falcon/queue';
import { captureException } from '@falcon/observability';
import { getActiveSession } from '@/lib/session';
import { runFalconTurn } from '@/lib/falcon';

export const runtime = 'nodejs';

/** POST /api/falcon/summary — targeted, grounded prep summary (spec 002, US3/FR-008). Reuses the
 *  same grounded path as /ask; the topic seeds retrieval. Persisted with kind='summary'. */
export async function POST(req: Request) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await rateLimit(`falcon-ask:${s.userId}`, 30, 60)).ok) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  const body = (await req.json()) as { topic?: string; conversationId?: string };
  const topic = body.topic?.trim();
  if (!topic) return NextResponse.json({ error: 'topic required' }, { status: 400 });

  const question = `Summarize what I did related to: ${topic}. Give a short, factual brief I can use to prepare.`;
  try {
    const result = await runFalconTurn(s, question, 'summary', body.conversationId);
    return NextResponse.json(result);
  } catch (e) {
    captureException(e, { route: 'falcon/summary', userId: s.userId });
    return NextResponse.json({ error: 'Falcon is temporarily unavailable — try again in a moment.' }, { status: 503 });
  }
}
