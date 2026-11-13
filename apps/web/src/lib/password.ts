import 'server-only';
import { and, eq, schema } from '@fin/db';
import { verify } from '@node-rs/argon2';
import { getCtx } from './server';

/** Checks a password typed again to confirm a serious action. */
export async function passwordMatches(userId: string, password: string): Promise<boolean> {
  const [account] = await getCtx()
    .db.select({ hash: schema.account.password })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'credential')));
  return !!account?.hash && !!password && verify(account.hash, password);
}
