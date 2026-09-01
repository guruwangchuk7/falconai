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
  const body = (await req.json().catch(() => null)) as { action?: string; supersedesId?: string; ownerUserId?: string } | null;

  switch (body?.action) {
    case 'confirm': {
      const ownerUserId = typeof body.ownerUserId === 'string' && body.ownerUserId.trim() !== '' ? body.ownerUserId.trim() : undefined;
      const res = await confirmDecision(deps(), s.workspaceId, id, s.userId, ownerUserId);
      const httpStatus = ({ confirmed: 200, missing_decision: 400, not_found: 404, already_final: 409 } as const)[res.status];
      const errors: Partial<Record<typeof res.status, string>> = {
        missing_decision: 'Add decision text before confirming.',
        not_found: 'Decision not found.',
        already_final: 'This decision is already confirmed, superseded, or dismissed.',
      };
      return NextResponse.json(errors[res.status] ? { error: errors[res.status], ...res } : res, { status: httpStatus });
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
