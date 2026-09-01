import Link from 'next/link';
import { getActiveSession } from '@/lib/session';
import { DecisionForm } from './DecisionForm';

export const runtime = 'nodejs';

export default async function NewDecisionPage() {
  const session = await getActiveSession();
  if (!session) return null;
  return (
    <main className="max-w-xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-medium text-ink">Log a decision</h1>
        <Link href="/decisions" className="text-sm text-muted underline">← Decision Memory</Link>
      </div>
      <DecisionForm />
    </main>
  );
}
