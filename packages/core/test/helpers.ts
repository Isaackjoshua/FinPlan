import { createDb, schema } from '@fin/db';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Ctx } from '../src';

/** A context on the test database with a throwaway master key. */
export function testCtx(): Ctx & { close: () => Promise<void> } {
  const db = createDb(process.env.TEST_DATABASE_URL!);
  return { db, masterKey: randomBytes(32), close: () => db.close() };
}

export async function createUser(ctx: Ctx): Promise<string> {
  const id = randomUUID();
  await ctx.db.insert(schema.user).values({ id, name: 'Test', email: `${id}@example.test` });
  return id;
}
