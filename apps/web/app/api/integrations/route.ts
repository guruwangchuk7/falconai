import { NextResponse } from 'next/server';
import { schema } from '@falcon/db';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

export async function GET() {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const connections = await deps().db.withTenant(s.workspaceId, (tx) =>
    tx
      .select({
        id: schema.connection.id,
        provider: schema.connection.provider,
        status: schema.connection.status,
        lastSyncedAt: schema.connection.lastSyncedAt,
        lastError: schema.connection.lastError,
      })
      .from(schema.connection),
  );
  return NextResponse.json({ connections });
}
