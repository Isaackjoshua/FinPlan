import { Field, Flash } from '@/components/ui';
import Link from 'next/link';
import { signIn } from '../actions';

export const metadata = { title: 'Sign in' };

export default function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Sign in</h1>
      <Flash searchParams={searchParams} />
      <form action={signIn} className="space-y-4">
        <Field label="Email"><input name="email" type="email" required autoComplete="email" className="input" /></Field>
        <Field label="Password"><input name="password" type="password" required autoComplete="current-password" className="input" /></Field>
        <button className="btn w-full">Sign in</button>
      </form>
      <p className="mt-4 text-sm text-muted">New here? <Link href="/sign-up" className="link">Create an account</Link></p>
    </>
  );
}
