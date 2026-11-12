import { HASHED_MODELS, hashToken, markGrantRevoked } from '@fin/core';
import { and, eq, isNull, lt, schema, sql, type Db } from '@fin/db';

const { oauthRecords } = schema;

type Payload = Record<string, unknown>;

/**
 * Keeps the OAuth server's records in Postgres.
 *
 * The library identifies an access token, refresh token or authorisation code by
 * the secret string itself. Those are stored under a hash instead, so reading this
 * table (or a backup of it) does not hand anyone a working token.
 */
export function createAdapter(db: Db) {
  return class PostgresAdapter {
    readonly hashed: boolean;

    constructor(readonly model: string) {
      this.hashed = HASHED_MODELS.has(model);
    }

    key(id: string) {
      return this.hashed ? hashToken(id) : id;
    }

    where(id: string) {
      return and(eq(oauthRecords.model, this.model), eq(oauthRecords.id, this.key(id)));
    }

    async upsert(id: string, payload: Payload, expiresIn?: number): Promise<void> {
      const stored = { ...payload };
      // `jti` repeats the secret id; leave it out and put it back on the way in.
      if (this.hashed) delete stored.jti;
      const row = {
        payload: stored,
        grantId: typeof payload.grantId === 'string' ? payload.grantId : null,
        uid: typeof payload.uid === 'string' ? payload.uid : null,
        userCode: typeof payload.userCode === 'string' ? payload.userCode : null,
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      };
      await db
        .insert(oauthRecords)
        .values({ model: this.model, id: this.key(id), ...row })
        .onConflictDoUpdate({ target: [oauthRecords.model, oauthRecords.id], set: row });
    }

    restore(row: typeof oauthRecords.$inferSelect | undefined, id?: string): Payload | undefined {
      if (!row) return undefined;
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return undefined;
      return {
        ...row.payload,
        ...(this.hashed && id ? { jti: id } : {}),
        ...(row.consumedAt ? { consumed: Math.floor(row.consumedAt.getTime() / 1000) } : {}),
      };
    }

    async find(id: string): Promise<Payload | undefined> {
      const [row] = await db.select().from(oauthRecords).where(this.where(id));
      return this.restore(row, id);
    }

    async findByUid(uid: string): Promise<Payload | undefined> {
      const [row] = await db
        .select()
        .from(oauthRecords)
        .where(and(eq(oauthRecords.model, this.model), eq(oauthRecords.uid, uid)));
      return this.restore(row);
    }

    async findByUserCode(userCode: string): Promise<Payload | undefined> {
      const [row] = await db
        .select()
        .from(oauthRecords)
        .where(and(eq(oauthRecords.model, this.model), eq(oauthRecords.userCode, userCode)));
      return this.restore(row);
    }

    /** Marks a code or refresh token as used. Only the first caller succeeds. */
    async consume(id: string): Promise<void> {
      const updated = await db
        .update(oauthRecords)
        .set({ consumedAt: sql`now()` })
        .where(and(this.where(id), isNull(oauthRecords.consumedAt)))
        .returning({ id: oauthRecords.id });
      if (updated.length === 0) throw new Error(`${this.model} was already used`);
    }

    async destroy(id: string): Promise<void> {
      await db.delete(oauthRecords).where(this.where(id));
    }

    /** The library withdraws a whole grant, for example when a used refresh token is replayed. */
    async revokeByGrantId(grantId: string): Promise<void> {
      await db.delete(oauthRecords).where(eq(oauthRecords.grantId, grantId));
      await markGrantRevoked({ db }, grantId);
    }
  };
}

/** Removes records that have expired. Run now and then; nothing depends on it for correctness. */
export async function removeExpired(db: Db): Promise<void> {
  await db.delete(oauthRecords).where(lt(oauthRecords.expiresAt, sql`now()`));
  await db.delete(schema.idempotencyKeys).where(lt(schema.idempotencyKeys.expiresAt, sql`now()`));
  await db.delete(schema.rateLimits).where(lt(schema.rateLimits.windowStart, sql`now() - interval '1 day'`));
}
