import { getActiveSession } from '@/lib/session';
import { FalconPanel } from './FalconPanel';

export const runtime = 'nodejs';

export default async function FalconPage() {
  const session = await getActiveSession();
  if (!session) return null;

  return (
    <main>
      <h1 className="mb-2 text-xl font-medium text-ink">Ask Falcon</h1>
      <p className="mb-4 text-sm text-muted">
        Ask about your own work. Falcon answers only from what it has actually synced, and shows the
        sources for every claim — if it can&apos;t ground an answer, it says so.
      </p>
      <FalconPanel />
    </main>
  );
}
