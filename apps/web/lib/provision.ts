import { eq } from 'drizzle-orm';
import { getDb, schema } from '@falcon/db';

/** On sign-in: upsert the user, ensure a membership (create a personal workspace if none).
 *  Operates on the non-RLS'd identity tables via the root connection. */
export async function provisionUser(input: { email: string; name?: string | null; githubLogin?: string | null }): Promise<{ userId: string; workspaceId: string }> {
  const db = getDb().rootDb;

  const existing = await db.select().from(schema.users).where(eq(schema.users.email, input.email)).limit(1);
  let userId: string;
  if (existing[0]) {
    userId = existing[0].id;
    if (input.githubLogin) {
      await db.update(schema.users).set({ githubLogin: input.githubLogin, name: input.name ?? existing[0].name }).where(eq(schema.users.id, userId));
    }
  } else {
    const ins = await db.insert(schema.users).values({ email: input.email, name: input.name ?? null, githubLogin: input.githubLogin ?? null }).returning({ id: schema.users.id });
    userId = ins[0]!.id;
  }

  const mem = await db.select().from(schema.membership).where(eq(schema.membership.userId, userId)).limit(1);
  let workspaceId: string;
  if (mem[0]) {
    workspaceId = mem[0].workspaceId;
  } else {
    const ws = await db
      .insert(schema.workspace)
      .values({ name: `${input.name ?? input.email}'s workspace`, settings: { freshness_horizon_days: 180, retention_days: null } })
      .returning({ id: schema.workspace.id });
    workspaceId = ws[0]!.id;
    await db.insert(schema.membership).values({ userId, workspaceId, role: 'engineer' });
  }

  return { userId, workspaceId };
}
