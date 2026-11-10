import 'server-only';
import { getProfile, type Profile } from '@fin/core';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getAuth } from './auth';
import { getCtx } from './server';

export const getSessionUser = cache(async () => {
  const session = await getAuth().api.getSession({ headers: await headers() });
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
