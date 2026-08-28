import { auth } from './auth';

export interface ActiveSession {
  userId: string;
  workspaceId: string;
}

/** Resolve the authenticated user + active workspace, or null if unauthenticated. Every route
 *  and page that touches tenant data must gate on this. */
export async function getActiveSession(): Promise<ActiveSession | null> {
  const s = (await auth()) as (Record<string, unknown> | null);
  const userId = s?.userId as string | undefined;
  const workspaceId = s?.workspaceId as string | undefined;
  if (!userId || !workspaceId) return null;
  return { userId, workspaceId };
}
