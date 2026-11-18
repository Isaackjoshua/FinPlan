import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col px-6 pb-12 pt-[max(4rem,15dvh)] sm:justify-center sm:pt-12">
      <Link href="/" className="mb-6 text-sm font-semibold text-brand">FinPlan</Link>
      {children}
    </main>
  );
}
