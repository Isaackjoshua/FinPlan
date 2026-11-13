import { Field, Flash } from '@/components/ui';
import { getConsentRequest } from '@/lib/authServer';
import { getSessionUser } from '@/lib/session';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { decide } from './actions';

export const metadata = { title: 'Connect an AI app' };

const PERMISSIONS = {
  'finance:read': {
    title: 'See your financial information',
    detail: 'Your profile, goals, plans, check-ins and lesson progress.',
  },
  'finance:write': {
    title: 'Make changes for you',
    detail: 'Update your profile and goals, save new plan versions, log check-ins and suggest lessons. Every change is recorded and you can undo it. It can never delete anything.',
  },
} as const;

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-6 text-sm font-semibold text-brand">FinPlan</Link>
      {children}
    </main>
  );
}

export default async function Connect({ params, searchParams }: { params: Promise<{ uid: string }>; searchParams: Promise<{ error?: string }> }) {
  const { uid } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/connect/${uid}`)}`);

  const request = await getConsentRequest((await cookies()).toString());
  if (!request || request.uid !== uid) {
    return (
      <Shell>
        <h1 className="mb-2 text-2xl font-semibold">This request has expired</h1>
        <p className="text-sm text-muted">Go back to your AI app and start connecting again. Requests are only valid for ten minutes, and only in the browser that started them.</p>
      </Shell>
    );
  }
  if (request.redirect.kind === 'unsafe') {
    return (
      <Shell>
        <h1 className="mb-2 text-2xl font-semibold">This app cannot be connected</h1>
        <p className="text-sm text-muted">It asked to receive your approval over an unencrypted connection, which would let others on the network intercept it. Nothing has been shared.</p>
      </Shell>
    );
  }

  const name = request.clientName ?? 'An app';
  return (
    <Shell>
      <h1 className="mb-2 text-2xl font-semibold">Connect an AI app</h1>
      <Flash searchParams={searchParams} />
      <div className="card mb-4 space-y-2 text-sm">
        {/* Rendered as plain text: the name comes from the app and is not verified. */}
        <p><span className="font-semibold">{name}</span> wants to connect to your FinPlan account ({user.email}).</p>
        <p className="text-muted">
          {request.redirect.kind === 'https' && <>After you decide, you will be sent to <span className="font-medium text-ink">{request.redirect.host}</span>.</>}
          {request.redirect.kind === 'loopback' && <>After you decide, you will be sent to a program running on this device ({request.redirect.host}). Only continue if you started this from an app on this computer.</>}
          {request.redirect.kind === 'app' && <>After you decide, an app installed on this device will open ({request.redirect.host}). Only continue if you started this from that app.</>}
        </p>
        <p className="text-muted">The name above is what the app calls itself. FinPlan has not checked it. If you did not start this, choose Deny.</p>
      </div>

      <form action={decide} className="space-y-4">
        <input type="hidden" name="uid" value={uid} />
        <fieldset className="space-y-3">
          <legend className="label">Choose what it may do</legend>
          {request.scopes.map((scope) => (
            <label key={scope} className="card flex cursor-pointer items-start gap-3">
              <input type="checkbox" name="scope" value={scope} defaultChecked={scope === 'finance:read'} className="mt-1" />
              <span>
                <span className="block text-sm font-medium">{PERMISSIONS[scope].title}</span>
                <span className="block text-sm text-muted">{PERMISSIONS[scope].detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {request.scopes.includes('finance:write') && (
          <Field label="Your FinPlan password" hint="Only needed if you allow it to make changes.">
            <input name="password" type="password" autoComplete="current-password" className="input" />
          </Field>
        )}
        <p className="text-xs text-muted">FinPlan supports financial education and planning. Connected apps get no tools for trading or for recommending specific investments. You can disconnect an app at any time.</p>
        <div className="flex gap-3">
          <button name="decision" value="allow" className="btn flex-1">Allow</button>
          <button name="decision" value="deny" formNoValidate className="btn-quiet flex-1">Deny</button>
        </div>
      </form>
    </Shell>
  );
}
