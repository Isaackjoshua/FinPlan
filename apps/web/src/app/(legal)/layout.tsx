import { SiteFooter } from '@/components/site-footer';
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-5 pb-16 pt-10 sm:pt-16">
      <Link href="/" className="text-sm font-semibold text-brand">FinPlan</Link>
      <article className="legal mt-6">{children}</article>
      <SiteFooter className="mt-12 border-t border-line pt-6" />
    </main>
  );
}
