import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@falcon/db';

export interface Viewer {
  /** Full display name, or null if the identity provider gave us none. */
  name: string | null;
  /** First name only — for greetings ("Good afternoon, Guru"). */
  firstName: string | null;
  workspaceName: string;
}

/** Resolve the signed-in user's display name + workspace name for dashboard chrome. Identity
 *  tables (users/workspace) are non-RLS, so read them on the root connection.
 *
 *  Wrapped in React `cache()` so the layout and the page (which both need it in the same request)
 *  share a single DB round trip instead of each paying for one. */
export const getViewer = cache(async function getViewer(userId: string, workspaceId: string): Promise<Viewer> {
  const root = getDb().rootDb;
  const [users, workspaces] = await Promise.all([
    root.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId)).limit(1),
    root.select({ name: schema.workspace.name }).from(schema.workspace).where(eq(schema.workspace.id, workspaceId)).limit(1),
  ]);
  const name = users[0]?.name?.trim() || null;
  return {
    name,
    firstName: name ? name.split(/\s+/)[0]! : null,
    workspaceName: workspaces[0]?.name ?? 'Falcon',
  };
});
