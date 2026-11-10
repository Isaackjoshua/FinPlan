import { requireProfile } from '@/lib/session';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { signOut } from '../(auth)/actions';

const NAV = [
  ['/dashboard', 'Dashboard'],
  ['/profile', 'Profile'],
  ['/goals', 'Goals'],
  ['/plan', 'Plan'],
  ['/check-ins', 'Check-ins'],
] as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { name } = await requireProfile();
  return (
    <>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/dashboard" className="font-semibold text-brand">FinPlan</Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="text-muted hover:text-ink">{label}</Link>
            ))}
          </nav>
          <form action={signOut} className="ml-auto flex items-center gap-3 text-sm text-muted">
            <span className="hidden sm:inline">{name}</span>
            <button className="btn-quiet">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </>
  );
}
