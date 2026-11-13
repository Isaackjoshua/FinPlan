'use server';

import { finishConsent } from '@/lib/authServer';
import { back } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { getSessionUser } from '@/lib/session';
import { hitRateLimit } from '@fin/core';
import { and, eq, schema } from '@fin/db';
import { verify } from '@node-rs/argon2';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

async function passwordMatches(userId: string, password: string): Promise<boolean> {
  const [account] = await getCtx()
    .db.select({ hash: schema.account.password })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'credential')));
  return !!account?.hash && !!password && verify(account.hash, password);
}

export async function decide(form: FormData) {
  const uid = String(form.get('uid') ?? '');
  if (!/^[\w-]{10,100}$/.test(uid)) redirect('/dashboard');
  const page = `/connect/${uid}`;
  const user = await getSessionUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(page)}`);
  const browserCookies = (await cookies()).toString();

  if (form.get('decision') !== 'allow') {
    const denied = await finishConsent(browserCookies, { deny: true });
    redirect(denied?.returnTo ?? '/dashboard');
  }

  const scopes = form.getAll('scope').map(String);
  if (scopes.length === 0) back(page, 'error', 'Tick at least one permission, or choose Deny.');

  // Letting an app change your data is the more serious permission, so it needs your password again.
  if (scopes.includes('finance:write')) {
    const attempts = await hitRateLimit(getCtx(), `consent-password:${user.id}`, 5, 15 * 60);
    if (!attempts.allowed) back(page, 'error', 'Too many password attempts. Wait a few minutes and try again.');
    if (!(await passwordMatches(user.id, String(form.get('password') ?? '')))) {
      back(page, 'error', 'To allow changes, enter your FinPlan password. The one you typed did not match.');
    }
  }

  const finished = await finishConsent(browserCookies, { userId: user.id, scopes });
  if (!finished) back(page, 'error', 'This request has expired. Go back to your AI app and connect again.');
  redirect(finished.returnTo);
}
