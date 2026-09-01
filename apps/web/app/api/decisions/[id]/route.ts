import { NextResponse } from 'next/server';
import { confirmDecision } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

/**
 * Decision lifecycle actions (US1 ships `confirm`; US3 `supersede` + US4 `dismiss` are added later).
 * RLS scopes every action to the caller's workspace — acting on another workspace's record simply
 * matches no row (treated as 404).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;

  switch (body?.action) {
    case 'confirm': {
      const res = await confirmDecision(deps(), s.workspaceId, id, s.userId);
      // 'noop' = nothing was unconfirmed to confirm (already confirmed/superseded, or not found).
      return NextResponse.json(res);
    }
    default:
      return NextResponse.json({ error: 'unknown or unsupported action' }, { status: 400 });
  }
}
