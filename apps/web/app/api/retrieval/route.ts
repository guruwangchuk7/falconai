import { NextResponse } from 'next/server';
import { retrieve, type RetrieveInput } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await getActiveSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json()) as { query?: string; k?: number; sources?: ('github' | 'linear' | 'jira')[] };
  if (!body.query) return NextResponse.json({ error: 'query required' }, { status: 400 });

  const input: RetrieveInput = {
    workspaceId: session.workspaceId,
    requesterUserId: session.userId,
    query: body.query,
    ...(body.k ? { k: body.k } : {}),
    ...(body.sources ? { sources: body.sources } : {}),
  };
  const result = await retrieve(deps(), input);
  return NextResponse.json(result);
}
