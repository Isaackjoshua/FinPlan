'use server';

import { getAuth, googleEnabled } from '@/lib/auth';
import { back, str } from '@/lib/forms';
import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export async function signUp(form: FormData) {
  const password = String(form.get('password') ?? '');
  if (password.length < 10) back('/sign-up', 'error', 'Use a password of at least 10 characters.');
  try {
    await getAuth().api.signUpEmail({
      body: { name: str(form, 'name'), email: str(form, 'email').toLowerCase(), password },
    });
  } catch (error) {
    if (error instanceof APIError) back('/sign-up', 'error', 'We could not create that account. Check the details and try again.');
    throw error;
  }
  redirect('/check-email');
}

// After signing in, a user who came from an AI app goes back to approve it. No other destination is accepted.
const safeNext = (value: string) => (/^\/connect\/[\w-]{10,100}$/.test(value) ? value : null);

export async function signIn(form: FormData) {
  const next = safeNext(str(form, 'next'));
  const page = next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in';
  try {
    await getAuth().api.signInEmail({
      body: { email: str(form, 'email').toLowerCase(), password: String(form.get('password') ?? '') },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      if (error.status === 'FORBIDDEN') redirect('/check-email');
      redirect(`${page}${next ? '&' : '?'}error=${encodeURIComponent('That email and password do not match an account.')}`);
    }
    throw error;
  }
  redirect(next ?? '/dashboard');
}

/** Sends the browser to Google. Afterwards it comes back to `callbackURL`, signed in. */
async function goToGoogle(callbackURL: string, errorPage: string): Promise<never> {
  if (!googleEnabled()) back(errorPage, 'error', 'Signing in with Google is not available.');
  const { url } = await getAuth().api.signInSocial({
    body: { provider: 'google', callbackURL, errorCallbackURL: errorPage },
    headers: await headers(),
  });
  if (!url) back(errorPage, 'error', 'Google sign-in could not be started. Try again.');
  redirect(url);
}

/** "Continue with Google" on the sign-in and sign-up pages. New accounts are created on the way. */
export async function signInWithGoogle(form: FormData) {
  const next = safeNext(str(form, 'next'));
  await goToGoogle(next ?? '/dashboard', next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in');
}

// Pages that may ask someone to confirm it is them: the consent page and the account page.
const safeReturn = (value: string) => safeNext(value) ?? (value === '/account' ? value : null);

/**
 * "Confirm with Google" for people without a FinPlan password. Signing in again starts a
 * new session, and a session only minutes old counts as confirmation (see signedInRecently).
 */
export async function confirmWithGoogle(form: FormData) {
  const returnTo = safeReturn(str(form, 'returnTo')) ?? '/dashboard';
  await goToGoogle(returnTo, returnTo);
}

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect('/');
}
