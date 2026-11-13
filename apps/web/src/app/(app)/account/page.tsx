import { Field, Flash, PageHeader } from '@/components/ui';
import { getAuth } from '@/lib/auth';
import { back } from '@/lib/forms';
import { passwordMatches } from '@/lib/password';
import { getCtx } from '@/lib/server';
import { requireUser } from '@/lib/session';
import { deleteAccount, hitRateLimit } from '@fin/core';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Your account' };

async function removeAccount(form: FormData) {
  'use server';
  const user = await requireUser();
  const attempts = await hitRateLimit(getCtx(), `delete-password:${user.id}`, 5, 15 * 60);
  if (!attempts.allowed) back('/account', 'error', 'Too many attempts. Wait a few minutes and try again.');
  if (form.get('confirm') !== 'on') back('/account', 'error', 'Tick the box to confirm that you want to delete your account.');
  if (!(await passwordMatches(user.id, String(form.get('password') ?? '')))) back('/account', 'error', 'That password did not match.');
  // Sign out first, while the session still exists, so the cookie is cleared.
  await getAuth().api.signOut({ headers: await headers() });
  await deleteAccount(getCtx(), user.id);
  redirect('/?notice=' + encodeURIComponent('Your account and all its data have been deleted.'));
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Your account">Signed in as {user.email}.</PageHeader>
      <Flash searchParams={searchParams} />

      <section className="card mb-6 max-w-2xl">
        <h2 className="font-semibold">Download your data</h2>
        <p className="mt-1 text-sm text-muted">One file with everything FinPlan holds about you: profile, goals, every plan version, check-ins, lesson progress, connected apps and their recent activity.</p>
        <a href="/account/export" className="btn-quiet mt-3">Download as JSON</a>
      </section>

      <section className="card max-w-2xl border-danger/30">
        <h2 className="font-semibold text-danger">Delete your account</h2>
        <p className="mt-1 text-sm text-muted">This removes your account and all your financial data, disconnects every AI app, and cannot be undone. Download your data first if you want a copy.</p>
        <form action={removeAccount} className="mt-3 space-y-3">
          <Field label="Your password"><input name="password" type="password" required autoComplete="current-password" className="input" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" /> I understand that this permanently deletes everything.</label>
          <button className="btn-quiet text-danger">Delete my account</button>
        </form>
      </section>
    </>
  );
}
