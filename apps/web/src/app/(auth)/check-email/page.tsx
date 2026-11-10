import Link from 'next/link';

export const metadata = { title: 'Check your email' };

export default function CheckEmail() {
  return (
    <>
      <h1 className="mb-3 text-2xl font-semibold">Check your email</h1>
      <p className="text-sm text-muted">
        If that address can be used for an account, we have sent it a link. Open the link to confirm your email
        address, then come back and sign in.
      </p>
      <p className="mt-4 text-sm"><Link href="/sign-in" className="link">Back to sign in</Link></p>
    </>
  );
}
