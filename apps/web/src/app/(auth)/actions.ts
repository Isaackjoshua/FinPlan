'use server';

import { getAuth } from '@/lib/auth';
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

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect('/');
}
