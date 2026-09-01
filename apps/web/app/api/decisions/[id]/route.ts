import { NextResponse } from 'next/server';
import { confirmDecision, supersedeDecision, dismissDecision } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

/**
 * Decision lifecycle actions: confirm (US1), supersede (US3), dismiss (US4). RLS scopes every action
 * to the caller's workspace — acting on another workspace's record simply matches no row (no-op).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: string; supersedesId?: string } | null;

  switch (body?.action) {
    case 'confirm': {
      // 'noop' = nothing was unconfirmed to confirm (already confirmed/superseded, or not found).
      return NextResponse.json(await confirmDecision(deps(), s.workspaceId, id, s.userId));
    }
    case 'supersede': {
      if (typeof body.supersedesId !== 'string') {
        return NextResponse.json({ error: 'supersedesId required' }, { status: 400 });
      }
      // [id] is the NEW confirmed record that supersedes body.supersedesId.
      return NextResponse.json(await supersedeDecision(deps(), s.workspaceId, { newRecordId: id, supersedesId: body.supersedesId }));
    }
    case 'dismiss': {
      return NextResponse.json(await dismissDecision(deps(), s.workspaceId, id));
    }
    default:
      return NextResponse.json({ error: 'unknown or unsupported action' }, { status: 400 });
  }
}
