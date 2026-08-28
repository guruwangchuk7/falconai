import { eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { effectiveDigestText } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';
import { DigestEditor } from './DigestEditor';

export const runtime = 'nodejs';

export default async function DigestPage() {
  const session = await getActiveSession();
  if (!session) return null;

  const rows = await deps().db.withTenant(session.workspaceId, (tx) =>
    tx.select().from(schema.workDigest).where(eq(schema.workDigest.userId, session.userId)).limit(1),
  );
  const d = rows[0];
  const initial = (d ? effectiveDigestText(d) : '') ?? '';

  return (
    <main>
      <h1 className="mb-2 text-xl font-medium text-ink">Your Work Digest</h1>
      <p className="mb-4 text-sm text-muted">
        What Falcon thinks you have been working on. Edit it if it is wrong — your version is what
        gets used.
      </p>
      {d ? (
        <DigestEditor initial={initial} />
      ) : (
        <p className="text-muted">No digest yet. It is generated nightly once your work is synced.</p>
      )}
    </main>
  );
}
