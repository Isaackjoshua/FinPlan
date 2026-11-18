import { Nav } from '@/components/nav';
import { requireProfile } from '@/lib/session';
import type { ReactNode } from 'react';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { name } = await requireProfile();
  return (
    <>
      <Nav name={name} />
      {/* Extra space at the bottom on phones so the tab bar never covers the last item. */}
      <main id="main" className="mx-auto max-w-5xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 sm:pt-8 md:pb-16">
        {children}
      </main>
    </>
  );
}
