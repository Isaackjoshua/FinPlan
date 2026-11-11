import 'server-only';
import { getProfile, type Profile } from '@fin/core';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getAuth } from './auth';
import { getCtx } from './server';

export const getSessionUser = cache(async () => {
  // Read the request first: that tells Next this page is per-request, so it is never
  // pre-rendered at build time (when there is no database to talk to).
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  return session?.user ?? null;
});

/** For pages and actions that need a signed-in user. */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');
  return user;
}

/** For pages and actions that also need the profile (country and currency) to exist. */
export const requireProfile = cache(async (): Promise<{ userId: string; name: string; profile: Profile }> => {
  const user = await requireUser();
  const profile = await getProfile(getCtx(), user.id);
  if (!profile) redirect('/onboarding');
  return { userId: user.id, name: user.name, profile };
});
