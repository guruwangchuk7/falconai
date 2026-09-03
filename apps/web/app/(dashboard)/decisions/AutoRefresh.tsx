'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Live-refresh the Decision Memory queue: meeting-mined decisions land asynchronously (post-meeting
 * extraction runs in the worker), so a static server render would need a manual reload to show them.
 * This polls `router.refresh()` — which re-runs the server component and reconciles new rows in place
 * without a full page reload or losing client state (the search box, in-flight confirm buttons).
 * Pauses while the tab is hidden to avoid needless round-trips.
 */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = setInterval(tick, intervalMs);
    // Refresh immediately when the tab regains focus so a returning user sees the latest at once.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, intervalMs]);
  return null;
}
