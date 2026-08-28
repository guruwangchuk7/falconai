import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@falcon/db';
import { linearEnv, loadEnv } from '@falcon/config';
import { defaultJobOpts, rateLimit, syncQueue } from '@falcon/queue';

export const runtime = 'nodejs';

/** Linear webhook: verify the HMAC signature, resolve the owning connection by organizationId,
 *  and enqueue a cursored sync for near-real-time indexing (no inline DB writes on the hot path). */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await rateLimit(`wh:linear:${ip}`, 120, 60)).ok) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }
  const secret = loadEnv(linearEnv).LINEAR_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'linear webhook not configured' }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get('linear-signature') ?? '';
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  const payload = JSON.parse(raw) as { organizationId?: string };
  const orgId = payload.organizationId;
  if (!orgId) return NextResponse.json({ ok: true });

  // Resolve the owning connection across tenants (iterate workspaces; a linear_orgs index table is
  // the scale-up, same shape as the GitHub webhook — see HANDOFF / TODOS F3).
  const db = getDb();
  const workspaces = await db.rootDb.select({ id: schema.workspace.id }).from(schema.workspace);
  for (const ws of workspaces) {
    const conns = await db.withTenant(ws.id, (tx) =>
      tx.select({ id: schema.connection.id }).from(schema.connection)
        .where(and(eq(schema.connection.provider, 'linear'), eq(schema.connection.externalAccountRef, orgId))),
    );
    for (const c of conns) await syncQueue().add('sync', { workspaceId: ws.id, connectionId: c.id }, defaultJobOpts);
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}
