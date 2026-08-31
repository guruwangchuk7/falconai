import { conn } from '@falcon/queue';
import { createEventLog, projectPanel, type PanelEvent } from '@falcon/session-core';
import { getActiveSession } from '@/lib/session';
import { PairingError, getSessionView } from '@/lib/pairing';

export const runtime = 'nodejs';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * GET /api/session/{id}/stream — SSE transcript stream to the panel (contracts/sse-panel.md).
 * Membership-gated (a non-member / cross-tenant id → 404 via RLS). Emits an initial snapshot of the
 * merged transcript then polls for new events. Strictly plumbing: the event enum is tracking-only —
 * no card / nudge / escalation (FR-023, enforced by PanelEvent's type).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getActiveSession();
  if (!s) return json({ error: 'unauthorized' }, 401);
  const { id } = await params;
  try {
    await getSessionView(s, id); // 404 for non-members / cross-tenant
  } catch (e) {
    if (e instanceof PairingError) return json({ error: e.message }, e.status);
    throw e;
  }

  const log = createEventLog(conn(), id);
  const encoder = new TextEncoder();
  let lastStreamId = '';
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: PanelEvent) =>
        controller.enqueue(encoder.encode(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`));
      const pump = async () => {
        const tail = await log.readFrom(lastStreamId || null);
        if (!tail.length) return;
        for (const pe of projectPanel(tail)) send(pe);
        lastStreamId = tail[tail.length - 1]!.id;
      };
      await pump(); // initial snapshot
      const interval = setInterval(() => void pump().catch(() => {}), 800);
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener('abort', stop);
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
