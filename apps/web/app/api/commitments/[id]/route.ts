import { NextResponse } from 'next/server';
import { setCommitmentDone } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

/**
 * Toggle a commitment open⇄done. RLS scopes the action to the caller's workspace — acting on another
 * workspace's commitment simply matches no row (not_found).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { done?: boolean } | null;
  if (typeof body?.done !== 'boolean') {
    return NextResponse.json({ error: 'done (boolean) required' }, { status: 400 });
  }
  const res = await setCommitmentDone(deps(), s.workspaceId, id, body.done);
  if (res.status === 'not_found') return NextResponse.json({ error: 'Commitment not found.' }, { status: 404 });
  return NextResponse.json(res);
}
