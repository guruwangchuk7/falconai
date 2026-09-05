import { getActiveSession } from '@/lib/session';
import { getViewer } from '@/lib/viewer';
import { FalconPanel } from './FalconPanel';

export const runtime = 'nodejs';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function FalconPage() {
  const session = await getActiveSession();
  if (!session) return null;

  const viewer = await getViewer(session.userId, session.workspaceId);
  const hello = viewer.firstName ? `${greeting(new Date().getHours())}, ${viewer.firstName}` : greeting(new Date().getHours());

  return (
    <main>
      <h1 className="font-display text-[32px] font-medium leading-tight tracking-[-0.2px] text-ink">{hello}</h1>
      <p className="mt-3 text-[15px] text-muted">
        Ask about your work and your team&apos;s decisions. Falcon answers only from what it has actually
        synced, shows the source for every claim, and tells you when it can&apos;t ground an answer.
      </p>
      <div className="mt-8">
        <FalconPanel />
      </div>
    </main>
  );
}
