import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveSession } from '@/lib/session';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getActiveSession();
  if (!session) redirect('/api/auth/signin');

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-8 flex items-center gap-6 border-b border-hairline pb-4">
        <span className="font-medium text-ink">Falcon</span>
        <nav className="flex gap-4 text-sm text-muted">
          <Link href="/integrations">Integrations</Link>
          <Link href="/me/digest">My digest</Link>
          <Link href="/decisions">Decisions</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
