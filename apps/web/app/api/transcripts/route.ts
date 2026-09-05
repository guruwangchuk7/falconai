import { NextResponse } from 'next/server';
import { rateLimit, meetingExtractQueue, meetingExtractJobId, defaultJobOpts } from '@falcon/queue';
import { captureException } from '@falcon/observability';
import { ingestPastedTranscript, DECISION_QUEUE_LINK } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { getViewer } from '@/lib/viewer';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

/** Guardrail against pasting a whole book — the extractor chunks, but a runaway paste would burn budget. */
const MAX_TRANSCRIPT_CHARS = 100_000;

/**
 * POST /api/transcripts — transcript-paste → decision extraction (C1, web-only capture).
 * Parses the pasted text, creates a meeting + working copy via the shipped feature-005 helpers, and
 * enqueues the SAME `meeting-extract` job the live mic path uses. Decisions surface in /decisions as
 * unconfirmed, cited records for one-click confirm. No mic, no desktop app.
 */
export async function POST(req: Request) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!(await rateLimit(`transcript-ingest:${s.userId}`, 10, 60)).ok) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  const body = (await req.json()) as { text?: string; title?: string };
  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: 'transcript text required' }, { status: 400 });
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    return NextResponse.json({ error: `transcript too long (max ${MAX_TRANSCRIPT_CHARS.toLocaleString()} characters)` }, { status: 413 });
  }

  try {
    const viewer = await getViewer(s.userId, s.workspaceId);
    const result = await ingestPastedTranscript(deps(), s.workspaceId, {
      userId: s.userId,
      displayName: viewer.name,
      title: body.title ?? null,
      text,
    });
    if (!result) return NextResponse.json({ error: 'No usable lines in that transcript.' }, { status: 400 });

    // Same queue + coalescing jobId as the live meeting path (idempotent on re-submit).
    await meetingExtractQueue().add(
      'meeting-extract',
      { workspaceId: s.workspaceId, meetingId: result.meetingId },
      { ...defaultJobOpts, jobId: meetingExtractJobId(s.workspaceId, result.meetingId) },
    );

    return NextResponse.json({
      meetingId: result.meetingId,
      utteranceCount: result.utteranceCount,
      queueLink: DECISION_QUEUE_LINK,
    });
  } catch (e) {
    captureException(e, { route: 'transcripts', userId: s.userId });
    return NextResponse.json(
      { error: 'Falcon could not process that transcript — try again in a moment.' },
      { status: 503 },
    );
  }
}
