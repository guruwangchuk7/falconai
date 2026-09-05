'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Quiet Voltage sidebar shell. The IA is Falcon's own — the reference's sidebar organisation,
 *  active-state treatment, pill CTA, and icon style, mapped onto Falcon's real routes. No fake
 *  sections: only Ask / Decisions / Digest / Sources, because those are the only things Falcon does. */

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Real count badge (e.g. decisions awaiting confirmation) — omitted when zero. */
  count?: number;
}

// Stroke icons, 1.8 weight — matches the reference's calm, hairline icon treatment.
const icons = {
  ask: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.4 8.4 0 0 1-1.1 4.2A8.5 8.5 0 0 1 12 20a8.4 8.4 0 0 1-4.2-1.1L3 20l1.1-4.8A8.4 8.4 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z" />
    </svg>
  ),
  decisions: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.3 2.3 4.7-5" />
    </svg>
  ),
  digest: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.6 4.8L18 9l-4.4 1.2L12 15l-1.6-4.8L6 9l4.4-1.2z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  ),
  sources: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="8" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="14" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="10" cy="17" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  ),
  transcript: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M8.5 13h4M8.5 16.5h5" />
    </svg>
  ),
  commitments: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M8.5 13l2 2 4-4.5" />
    </svg>
  ),
};

export function Sidebar({ userName, workspaceName, queueCount, commitmentCount }: { userName: string; workspaceName: string; queueCount: number; commitmentCount: number }) {
  const pathname = usePathname();

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: 'Workspace',
      items: [
        { href: '/falcon', label: 'Ask', icon: icons.ask },
        { href: '/decisions', label: 'Decisions', icon: icons.decisions, count: queueCount || undefined },
        { href: '/commitments', label: 'Commitments', icon: icons.commitments, count: commitmentCount || undefined },
        { href: '/transcripts', label: 'Add transcript', icon: icons.transcript },
        { href: '/me/digest', label: 'Digest', icon: icons.digest },
      ],
    },
    {
      label: 'Setup',
      items: [{ href: '/integrations', label: 'Integrations', icon: icons.sources }],
    },
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <aside className="flex w-[248px] flex-shrink-0 flex-col border-r border-hairline bg-surface px-4 py-5">
      {/* account / workspace row */}
      <div className="flex items-center gap-2.5 px-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/falcon.png" alt="Falcon" width={30} height={30} className="h-[30px] w-[30px] flex-shrink-0 object-contain" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium leading-tight text-ink">{userName}</span>
          <span className="block truncate text-[12px] leading-tight text-muted">{workspaceName}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-muted-soft" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>

      {/* nav — grouped into labeled sections */}
      <nav className="mt-6 flex flex-col gap-5">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <div className="mb-1 px-2.5 text-[12px] font-medium uppercase tracking-[0.07em] text-muted-soft">{group.label}</div>
            {group.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors ${
                    active ? 'bg-surface-strong' : 'hover:bg-surface-strong/60'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className={`h-[17px] w-[17px] ${active ? 'text-ink' : 'text-muted'}`}>{item.icon}</span>
                    <span className={`text-[14.5px] font-medium ${active ? 'text-ink' : 'text-body-strong'}`}>{item.label}</span>
                  </span>
                  {item.count ? (
                    <span className="rounded-full bg-surface-strong px-2 py-0.5 text-[12px] font-semibold text-muted">{item.count}</span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex-1" />

      {/* footer chip — honest status, no fake billing */}
      <div className="flex items-center justify-center gap-2 rounded-full border border-hairline px-3 py-2 text-[12.5px] font-medium text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-forest" />
        Private beta
      </div>
    </aside>
  );
}
