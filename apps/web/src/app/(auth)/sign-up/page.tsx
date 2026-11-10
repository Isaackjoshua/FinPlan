import { Field, Flash } from '@/components/ui';
import Link from 'next/link';
import { signUp } from '../actions';

export const metadata = { title: 'Create an account' };

export default function SignUp({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Create an account</h1>
      <Flash searchParams={searchParams} />
      <form action={signUp} className="space-y-4">
        <Field label="Name"><input name="name" required maxLength={80} autoComplete="name" className="input" /></Field>
        <Field label="Email"><input name="email" type="email" required autoComplete="email" className="input" /></Field>
        <Field label="Password" hint="At least 10 characters.">
          <input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className="input" />
        </Field>
        <button className="btn w-full">Create account</button>
      </form>
      <p className="mt-4 text-sm text-muted">Already have an account? <Link href="/sign-in" className="link">Sign in</Link></p>
    </>
  );
}
