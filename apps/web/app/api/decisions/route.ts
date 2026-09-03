import { NextResponse } from 'next/server';
import { createDecision, searchDecisions } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const q = new URL(req.url).searchParams.get('q') ?? '';
  const results = q ? await searchDecisions(deps(), s.workspaceId, q, 10, 180, undefined, s.userId) : [];
  return NextResponse.json({ results });
}

/** Capture a decision (US1). Stored as `unconfirmed` — not retrievable until confirmed (F10.1). */
export async function POST(req: Request) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    title?: string; decision?: string; rationale?: string; options?: unknown;
    dissent?: string; sourceRef?: string;
  } | null;
  if (!body || typeof body.title !== 'string' || body.title.trim() === '') {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }
  const { id } = await createDecision(deps(), s.workspaceId, {
    title: body.title.trim(),
    decision: body.decision?.trim() || undefined,
    rationale: body.rationale?.trim() || undefined,
    options: body.options ?? undefined,
    dissent: body.dissent?.trim() || undefined,
    ownerUserId: s.userId,
    sourceRef: body.sourceRef?.trim() || undefined,
    origin: 'manual',
  });
  return NextResponse.json({ id }, { status: 201 });
}
