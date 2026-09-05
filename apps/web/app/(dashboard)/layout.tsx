import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { listQueue, countOpenCommitments } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { getViewer } from '@/lib/viewer';
import { deps } from '@/lib/deps';
import { Sidebar } from './Sidebar';

export const runtime = 'nodejs';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getActiveSession();
  if (!session) redirect('/signin');

  // Sidebar chrome: who's signed in, which workspace, and the real "awaiting confirmation" count
  // that feeds the Decisions badge.
  const [viewer, queue, commitmentCount] = await Promise.all([
    getViewer(session.userId, session.workspaceId),
    listQueue(deps(), session.workspaceId, 100, undefined, session.userId).catch(() => []),
    countOpenCommitments(deps(), session.workspaceId).catch(() => 0),
  ]);

  const userName = viewer.name ?? 'Your workspace';
  const workspaceName = viewer.workspaceName;

  return (
    <div className="flex h-screen">
      <Sidebar userName={userName} workspaceName={workspaceName} queueCount={queue.length} commitmentCount={commitmentCount} />
      <div className="flex-1 overflow-auto">
        {/* Layout supplies padding only (design.md main: 56px 64px). Each page caps its own reading
            column so wide pages (the Ask dashboard) can use the space and list pages stay readable. */}
        <div className="px-16 py-14">{children}</div>
      </div>
    </div>
  );
}
