'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { signOut } from '../app/(auth)/actions';

// Drawn for FinPlan: 24px grid, 1.75 stroke, round joins.
const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);
const ICONS = {
  home: icon(<><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></>),
  plan: icon(<><path d="M5 19V13M10 19V9M15 19v-4M20 19V5" /></>),
  goals: icon(<><path d="M6 21V4" /><path d="M6 4h11l-2.5 4L17 12H6" /></>),
  checkIns: icon(<><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M8.5 13.5l2.5 2.5 4.5-5" /></>),
  more: icon(<><circle cx="5.5" cy="12" r="1.25" fill="currentColor" /><circle cx="12" cy="12" r="1.25" fill="currentColor" /><circle cx="18.5" cy="12" r="1.25" fill="currentColor" /></>),
};

/** Shown in the bottom bar on phones. */
const PRIMARY = [
  { href: '/dashboard', label: 'Home', icon: ICONS.home },
  { href: '/plan', label: 'Plan', icon: ICONS.plan },
  { href: '/goals', label: 'Goals', icon: ICONS.goals },
  { href: '/check-ins', label: 'Check-ins', icon: ICONS.checkIns },
] as const;
/** Under "More" on phones. */
const SECONDARY = [
  { href: '/profile', label: 'Profile' },
  { href: '/lessons', label: 'Lessons' },
  { href: '/agents', label: 'AI apps' },
  { href: '/account', label: 'Account' },
] as const;
/** The top bar on larger screens: everything but Account, which sits by the name. */
const ALL = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/profile', label: 'Profile' },
  { href: '/goals', label: 'Goals' },
  { href: '/plan', label: 'Plan' },
  { href: '/check-ins', label: 'Check-ins' },
  { href: '/lessons', label: 'Lessons' },
  { href: '/agents', label: 'AI apps' },
] as const;

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function Nav({ name }: { name: string }) {
  const pathname = usePathname();
  const more = useRef<HTMLDetailsElement>(null);
  // Links change the page without reloading it, so close the "More" sheet ourselves.
  useEffect(() => {
    if (more.current) more.current.open = false;
  }, [pathname]);
  const moreActive = SECONDARY.some((item) => isActive(pathname, item.href));

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight text-brand">
            <span aria-hidden="true" className="grid size-7 place-items-center rounded-lg bg-brand text-white">
              <svg viewBox="0 0 24 24" className="size-4" fill="currentColor"><rect x="5" y="13" width="3.5" height="6" rx="1" /><rect x="10.25" y="9.5" width="3.5" height="9.5" rx="1" /><rect x="15.5" y="6" width="3.5" height="13" rx="1" /></svg>
            </span>
            FinPlan
          </Link>
          <nav aria-label="Main" className="hidden h-full items-stretch gap-1 md:flex">
            {ALL.map(({ href, label }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center border-b-2 px-2.5 text-sm transition-colors ${active ? 'border-brand font-medium text-ink' : 'border-transparent text-muted hover:text-ink'}`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          <form action={signOut} className="ml-auto hidden items-center gap-3 text-sm md:flex">
            <Link href="/account" className={`hover:text-ink ${isActive(pathname, '/account') ? 'text-ink' : 'text-muted'}`}>{name}</Link>
            <button className="btn-quiet">Sign out</button>
          </form>
        </div>
      </header>

      {/* Phones: a tab bar within reach of the thumb. */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {PRIMARY.map(({ href, label, icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${active ? 'text-brand' : 'text-muted'}`}
                >
                  {icon}
                  {label}
                </Link>
              </li>
            );
          })}
          <li>
            <details ref={more}>
              <summary className={`flex h-16 cursor-pointer list-none flex-col items-center justify-center gap-1 text-[11px] font-medium [&::-webkit-details-marker]:hidden ${moreActive ? 'text-brand' : 'text-muted'}`}>
                {ICONS.more}
                More
              </summary>
              <div className="absolute inset-x-3 bottom-[calc(100%+0.5rem)] rounded-2xl border border-line bg-white p-2 shadow-[0_12px_32px_-12px_rgb(23_32_28/0.35)]">
                <p className="px-3 pb-1 pt-2 text-xs text-muted">Signed in as {name}</p>
                <ul>
                  {SECONDARY.map(({ href, label }) => (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={isActive(pathname, href) ? 'page' : undefined}
                        className={`flex min-h-12 items-center rounded-xl px-3 text-base ${isActive(pathname, href) ? 'bg-brand-soft font-medium text-brand-dark' : 'hover:bg-paper'}`}
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
                <form action={signOut} className="mt-1 border-t border-line pt-1">
                  <button className="flex min-h-12 w-full cursor-pointer items-center rounded-xl px-3 text-base text-danger hover:bg-paper">Sign out</button>
                </form>
              </div>
            </details>
          </li>
        </ul>
      </nav>
    </>
  );
}
