import { Flash } from '@/components/ui';
import { getSessionUser } from '@/lib/session';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function Home({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  if (await getSessionUser()) redirect('/dashboard');
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <Flash searchParams={searchParams} />
      <p className="text-sm font-semibold text-brand">FinPlan</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">A financial plan you build with your own AI agent.</h1>
      <p className="mt-4 text-lg text-muted">
        Keep your income, debts, savings and goals in one place. Your agent helps you turn them into a plan and
        points you to short lessons on what matters for you.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/sign-up" className="btn">Create an account</Link>
        <Link href="/sign-in" className="btn-quiet">Sign in</Link>
      </div>
      <p className="mt-10 text-xs text-muted">
        FinPlan supports financial education and planning. It does not give investment advice or recommend
        specific investments.
      </p>
    </main>
  );
}
