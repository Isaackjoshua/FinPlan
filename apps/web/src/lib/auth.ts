import 'server-only';
import { schema } from '@fin/db';
import { hash, verify } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { sendEmail } from './mailer';
import { getCtx } from './server';

function build() {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getCtx().db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // argon2id with the library defaults (19 MiB memory, 2 passes).
      password: {
        hash: (password) => hash(password),
        verify: ({ hash: stored, password }) => verify(stored, password),
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: 'Confirm your email address',
          text: `Open this link to confirm your email address and finish creating your account:\n\n${url}\n\nIf you did not sign up, you can ignore this message.`,
        });
      },
    },
    rateLimit: { enabled: true, window: 60, max: 30 },
    // Must be last: lets server actions set the session cookie.
    plugins: [nextCookies()],
  });
}

const globals = globalThis as { __finAuth?: ReturnType<typeof build> };
export const getAuth = () => (globals.__finAuth ??= build());
