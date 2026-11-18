import { CONTACT_EMAIL, LEGAL_UPDATED } from '@/lib/site';
import Link from 'next/link';

export const metadata = { title: 'Terms of service', description: 'The terms for using FinPlan.' };

export default function Terms() {
  return (
    <>
      <h1>Terms of service</h1>
      <p className="updated">Last updated {LEGAL_UPDATED}</p>

      <p>
        These terms apply when you use FinPlan. By creating an account or signing in, you agree to them. How we handle
        your information is covered in the <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>What FinPlan is</h2>
      <p>
        FinPlan helps you record your finances, build a plan, track progress and learn the basics of personal finance,
        on your own or with an AI app you connect.
      </p>
      <p>
        <strong>FinPlan is for education and planning only. It is not financial, investment, tax or legal advice.</strong>{' '}
        It does not recommend specific investments, and it cannot buy, sell or move money. Projections are estimates
        based on what you enter and on simple assumptions (such as fixed interest rates and no fees). They are not
        predictions. For decisions that matter, speak to a qualified adviser.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be 18 or older to use FinPlan.</li>
        <li>Give accurate details when you sign up, and keep your password, or your Google account, secure.</li>
        <li>You are responsible for what happens under your account, including what AI apps you connect do with the permissions you give them.</li>
        <li>Tell us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> if you think someone else has used your account.</li>
      </ul>

      <h2>Connecting AI apps</h2>
      <ul>
        <li>
          You choose which apps to connect and whether each may only read your information or also make changes. You
          can disconnect an app, and undo its changes, at any time.
        </li>
        <li>
          AI apps are provided by other companies under their own terms. FinPlan checks what each app may do, but it
          does not control what an app says to you or what it does with the information it reads. Check suggestions
          before you rely on them.
        </li>
      </ul>

      <h2>Acceptable use</h2>
      <p>Do not:</p>
      <ul>
        <li>use FinPlan for anything unlawful, or to store information about other people without their permission;</li>
        <li>try to get into accounts or data that are not yours, or to get around FinPlan&apos;s security or usage limits;</li>
        <li>overload, disrupt or reverse-engineer the service, or access it in automated ways other than through the connections FinPlan offers.</li>
      </ul>

      <h2>Your information</h2>
      <p>
        Your financial information is yours. You give FinPlan permission to store and process it only to provide the
        service to you. You can download it or delete it from your <Link href="/account">account page</Link> at any time.
      </p>

      <h2>Availability and changes</h2>
      <p>
        FinPlan is provided as it is and as available. We work to keep it running and your data safe, but we cannot
        promise it will always be available or free of errors. We may change or stop features, and will give notice by
        email of changes that significantly affect you. If FinPlan is ever shut down, you will be told in advance and
        given time to download your data.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent the law allows, FinPlan is not liable for any financial loss or decision you make based on
        information, projections or lessons in the service, or on anything a connected AI app tells you. Nothing in
        these terms limits liability that cannot be limited by law.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop using FinPlan and delete your account at any time. We may suspend or close an account that breaks
        these terms, and will tell you why unless the law prevents it.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        If these terms change, the new version will be posted here with a new date, and significant changes will be
        emailed to you in advance. Continuing to use FinPlan after a change means you accept the new terms.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
    </>
  );
}
