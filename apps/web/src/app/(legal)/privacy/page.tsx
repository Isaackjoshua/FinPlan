import { CONTACT_EMAIL, LEGAL_UPDATED } from '@/lib/site';
import Link from 'next/link';

export const metadata = { title: 'Privacy policy', description: 'What FinPlan collects, why, where it is kept, and how to get it back or delete it.' };

export default function PrivacyPolicy() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p className="updated">Last updated {LEGAL_UPDATED}</p>

      <p>
        FinPlan is a tool for building and keeping a personal financial plan, on your own or with an AI app you
        connect. This page explains what FinPlan collects, why, where it is kept, who else is involved, and how you
        can get your data back or delete it. Questions go to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>What we collect</h2>
      <h3>Your account</h3>
      <ul>
        <li>Your name and email address.</li>
        <li>
          If you sign up with a password: a one-way hash of it (argon2id). The password itself is never stored and
          cannot be read back.
        </li>
        <li>
          If you sign in with Google: your Google account identifier, name, email address and profile picture link,
          which Google shares when you agree to sign in. We do not get your Google password or access to anything else
          in your Google account.
        </li>
        <li>
          For each signed-in session: the time, your IP address and your browser&apos;s user agent, so sessions can be
          secured and signed out.
        </li>
      </ul>

      <h3>Your financial information</h3>
      <ul>
        <li>What you or a connected AI app enter: income, expenses, debts, savings, goals, plan versions, check-ins and notes.</li>
        <li>Your lesson progress and quiz answers.</li>
        <li>The country and currency you choose.</li>
      </ul>

      <h3>Connected AI apps</h3>
      <ul>
        <li>Which apps you connected, the permissions you gave each one, and when it was last used.</li>
        <li>
          A log of each request an app makes: what it asked to do, whether it was allowed, and which item it changed.
          The log records names of things, never the amounts or text involved.
        </li>
      </ul>

      <p>
        FinPlan has no advertising, no analytics and no third-party trackers. It sets only the cookies it needs to keep
        you signed in and, while you are connecting an AI app, to tie your approval to your browser.
      </p>

      <h2>Why we use it</h2>
      <ul>
        <li>To run your account and sign you in.</li>
        <li>To store your plan and work out its projections.</li>
        <li>To let AI apps you connect read or change your data, within the permissions you choose.</li>
        <li>To send email you need, such as the link that confirms your address.</li>
        <li>To keep the service secure, for example by limiting repeated sign-in attempts.</li>
      </ul>
      <p>We do not sell your data, use it for advertising, or use it to train AI models.</p>

      <h2>How it is protected</h2>
      <ul>
        <li>
          Your financial information is encrypted before it is written to the database (AES-256-GCM), with a key that
          belongs to your account alone. That key is itself encrypted with a master key kept separately from the
          database.
        </li>
        <li>All traffic to FinPlan is encrypted (HTTPS).</li>
        <li>
          Connected apps get short-lived access that is checked on every request, so disconnecting an app takes effect
          immediately. Apps cannot delete anything, and you can undo the changes they make.
        </li>
      </ul>

      <h2>Where it is kept and who else is involved</h2>
      <ul>
        <li><strong>Hosting:</strong> FinPlan runs on a server provided by Oracle Cloud, in Johannesburg, South Africa.</li>
        <li><strong>Email:</strong> confirmation emails are sent through Resend, which receives your email address and the message.</li>
        <li><strong>Google:</strong> only if you choose to sign in with Google, as described above.</li>
        <li>
          <strong>AI apps you connect:</strong> when you connect an app such as Claude or ChatGPT, the information it
          reads from FinPlan goes to that app&apos;s provider and is handled under their privacy policy, not this one.
          You choose which apps to connect and what they may do, and you can disconnect them at any time.
        </li>
      </ul>
      <p>We share your information with no one else, unless the law requires it.</p>

      <h2>How long we keep it</h2>
      <p>
        We keep your information for as long as you have an account. When you delete your account, your information is
        deleted, every connected app is disconnected, and the key that unlocks your financial information is destroyed.
        Any copy left in a backup can then no longer be read.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li><strong>See and correct it:</strong> everything you have entered is on your profile, goals, plan and check-in pages, where you can change it.</li>
        <li><strong>Take a copy:</strong> download all of it as one file from your <Link href="/account">account page</Link>.</li>
        <li><strong>Delete it:</strong> delete your account from the same page. This cannot be undone.</li>
        <li><strong>Control AI apps:</strong> see, restrict or disconnect connected apps, and undo their changes, on the <Link href="/agents">AI apps page</Link>.</li>
      </ul>
      <p>
        Depending on where you live, data protection law may give you further rights, such as objecting to how your
        information is used or complaining to a regulator. Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and
        we will respond.
      </p>

      <h2>Children</h2>
      <p>FinPlan is for people aged 18 and over, and we do not knowingly collect information from anyone younger.</p>

      <h2>Changes to this policy</h2>
      <p>
        If this policy changes, the new version will be posted here with a new date. If a change affects how your
        existing information is used, we will tell you by email first.
      </p>
    </>
  );
}
