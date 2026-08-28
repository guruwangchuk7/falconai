import { NextResponse } from 'next/server';
import { searchDecisions } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const q = new URL(req.url).searchParams.get('q') ?? '';
  const results = q ? await searchDecisions(deps(), s.workspaceId, q) : [];
  return NextResponse.json({ results });
}
