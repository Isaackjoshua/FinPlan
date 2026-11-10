import { Field, Flash } from '@/components/ui';
import { run, str } from '@/lib/forms';
import { countries, currencies } from '@/lib/places';
import { getCtx } from '@/lib/server';
import { requireUser } from '@/lib/session';
import { getProfile, setupProfile } from '@fin/core';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Set up' };

async function save(form: FormData) {
  'use server';
  const user = await requireUser();
  await run('/onboarding', () =>
    setupProfile(getCtx(), user.id, { country: str(form, 'country'), currency: str(form, 'currency') }),
  );
}

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  if (await getProfile(getCtx(), user.id)) redirect('/dashboard');
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="mb-2 text-2xl font-semibold">Welcome, {user.name}</h1>
      <p className="mb-6 text-sm text-muted">Two things before you start. All your amounts will be kept in the currency you choose here.</p>
      <Flash searchParams={searchParams} />
      <form action={save} className="space-y-4">
        <Field label="Country">
          <select name="country" required defaultValue="" className="input">
            <option value="" disabled>Choose a country</option>
            {countries().map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Currency" hint="This cannot be changed later.">
          <select name="currency" required defaultValue="" className="input">
            <option value="" disabled>Choose a currency</option>
            {currencies().map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
          </select>
        </Field>
        <button className="btn w-full">Continue</button>
      </form>
    </main>
  );
}
