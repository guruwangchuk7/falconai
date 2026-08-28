import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@falcon/db';
import { githubEnv, loadEnv } from '@falcon/config';
import { defaultJobOpts, syncQueue } from '@falcon/queue';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  const secret = loadEnv(githubEnv).GITHUB_WEBHOOK_SECRET;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  const payload = JSON.parse(raw) as { installation?: { id: number } };
  const installationId = payload.installation?.id;
  if (!installationId) return NextResponse.json({ ok: true });

  // Resolve the owning connection across tenants (iterate workspaces; a github_installations
  // index table is the scale-up — see HANDOFF). Then enqueue a cursored sync for near-real-time.
  const db = getDb();
  const workspaces = await db.rootDb.select({ id: schema.workspace.id }).from(schema.workspace);
  for (const ws of workspaces) {
    const conns = await db.withTenant(ws.id, (tx) =>
      tx.select({ id: schema.connection.id }).from(schema.connection).where(eq(schema.connection.externalAccountRef, String(installationId))),
    );
    for (const c of conns) await syncQueue().add('sync', { workspaceId: ws.id, connectionId: c.id }, defaultJobOpts);
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}
