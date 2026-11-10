import { eq, schema, type Db, type Executor } from '@fin/db';
import { newDataKey, unwrapDataKey, wrapDataKey } from './crypto';

/** Everything a service needs. Built once per process. */
export interface Ctx {
  db: Db;
  masterKey: Buffer;
}

/** Who is making a change. Agents are identified by their connection (added in milestone 4). */
export type Actor = { type: 'user' } | { type: 'agent'; connectionId: string | null };

export const USER: Actor = { type: 'user' };

export function actorColumns(actor: Actor) {
  return {
    actorType: actor.type,
    connectionId: actor.type === 'agent' ? actor.connectionId : null,
  } as const;
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

/** The caller's copy is out of date; they should re-read and try again. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Returns the user's data key, creating it on first use. */
export async function getUserKey(ctx: Ctx, userId: string, exec: Executor = ctx.db): Promise<Buffer> {
  const find = () =>
    exec.select().from(schema.userKeys).where(eq(schema.userKeys.userId, userId)).limit(1);

  let [row] = await find();
  if (!row) {
    // Two requests may race to create the key; the first insert wins and both read it back.
    await exec
      .insert(schema.userKeys)
      .values({ userId, wrappedKey: wrapDataKey(ctx.masterKey, userId, newDataKey()) })
      .onConflictDoNothing();
    [row] = await find();
  }
  if (!row) throw new NotFoundError('User key');
  return unwrapDataKey(ctx.masterKey, userId, row.wrappedKey);
}
