import { and, desc, eq, gt, isNull, lt, or, schema, sql, type Db, type Executor } from '@fin/db';
import { createHash, createHmac } from 'node:crypto';
import { ConflictError, getUserKey, NotFoundError, type Ctx } from './context';
import { openJson, sealJson } from './crypto';

const { oauthRecords, agentConnections, agentActivity, idempotencyKeys, rateLimits } = schema;

/** The two permissions a user can give an AI app. They are independent: write does not include read. */
export const SCOPES = ['finance:read', 'finance:write'] as const;
export type Scope = (typeof SCOPES)[number];
export const isScope = (value: string): value is Scope => (SCOPES as readonly string[]).includes(value);

/** These services touch no encrypted data, so they need the database only. */
type DbOnly = { db: Db };

/** Tokens are looked up by this hash; the token itself is never stored. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

/** One configured secret, several uses: each label gives an unrelated key. */
export const deriveSecret = (secret: string, label: string) => createHmac('sha256', secret).update(label).digest('base64url');

/** OAuth records that are secrets in themselves and are therefore stored under a hash. */
export const HASHED_MODELS: ReadonlySet<string> = new Set(['AccessToken', 'RefreshToken', 'AuthorizationCode']);

// An app's name is whatever the app says it is. Keep it short and printable.
const cleanName = (name: string | undefined) =>
  (name ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 80) || 'Unnamed app';

/** Removes a consent grant and every code and token issued under it. */
async function deleteGrant(exec: Executor, grantId: string): Promise<void> {
  await exec
    .delete(oauthRecords)
    .where(or(eq(oauthRecords.grantId, grantId), and(eq(oauthRecords.model, 'Grant'), eq(oauthRecords.id, grantId))));
}

// --- Connections ---------------------------------------------------------------

export interface Connection {
  id: string;
  clientId: string;
  clientName: string;
  scopes: Scope[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Records that the user approved an app. An earlier connection between the same
 * user and app is replaced, so there is exactly one live set of permissions to
 * look at and to revoke.
 */
export async function recordConsent(
  ctx: DbOnly,
  input: { userId: string; clientId: string; clientName?: string; grantId: string; scopes: readonly string[] },
): Promise<string> {
  const scopes = SCOPES.filter((s) => input.scopes.includes(s));
  if (scopes.length === 0) throw new Error('A connection needs at least one permission');
  return ctx.db.transaction(async (tx) => {
    const earlier = await tx
      .update(agentConnections)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(agentConnections.userId, input.userId),
          eq(agentConnections.clientId, input.clientId),
          isNull(agentConnections.revokedAt),
        ),
      )
      .returning({ grantId: agentConnections.grantId });
    for (const { grantId } of earlier) await deleteGrant(tx, grantId);

    const [row] = await tx
      .insert(agentConnections)
      .values({
        userId: input.userId,
        clientId: input.clientId,
        clientName: cleanName(input.clientName),
        grantId: input.grantId,
        scopes,
      })
      .returning({ id: agentConnections.id });
    return row!.id;
  });
}

export async function listConnections(ctx: DbOnly, userId: string): Promise<Connection[]> {
  const rows = await ctx.db
    .select()
    .from(agentConnections)
    .where(eq(agentConnections.userId, userId))
    .orderBy(desc(agentConnections.createdAt));
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: r.clientName,
    scopes: r.scopes.filter(isScope),
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt,
  }));
}

/** Cuts an app off. Its tokens are deleted, so its very next call fails. */
export async function revokeConnection(ctx: DbOnly, userId: string, connectionId: string): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(agentConnections)
      // Scoped by user: knowing a connection id is never enough to revoke it.
      .where(and(eq(agentConnections.id, connectionId), eq(agentConnections.userId, userId)));
    if (!row) throw new NotFoundError('Connection');
    await deleteGrant(tx, row.grantId);
    if (!row.revokedAt) {
      await tx.update(agentConnections).set({ revokedAt: sql`now()` }).where(eq(agentConnections.id, row.id));
    }
  });
}

/** The OAuth server withdrew a grant itself (for example a stolen refresh token was replayed). */
export async function markGrantRevoked(ctx: DbOnly, grantId: string): Promise<void> {
  await ctx.db
    .update(agentConnections)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(agentConnections.grantId, grantId), isNull(agentConnections.revokedAt)));
}

// --- Checking a token ----------------------------------------------------------

export interface AgentAuth {
  userId: string;
  connectionId: string;
  clientId: string;
  scopes: Scope[];
  /** Seconds since the epoch. */
  expiresAt: number;
}

/**
 * Decides whether an access token is good for this server right now. Looked up on
 * every call, which is what makes revoking a connection take effect immediately.
 * Returns null for anything that is not a live token issued for `resource`.
 */
export async function authenticateToken(ctx: DbOnly, token: string, resource: string): Promise<AgentAuth | null> {
  if (!token || token.length > 512) return null;
  const [record] = await ctx.db
    .select({ payload: oauthRecords.payload, grantId: oauthRecords.grantId, expiresAt: oauthRecords.expiresAt })
    .from(oauthRecords)
    .where(
      and(eq(oauthRecords.model, 'AccessToken'), eq(oauthRecords.id, hashToken(token)), gt(oauthRecords.expiresAt, sql`now()`)),
    );
  if (!record?.grantId || !record.expiresAt) return null;
  // A token issued for some other server must not work here.
  if (record.payload.aud !== resource) return null;

  const [connection] = await ctx.db
    .select()
    .from(agentConnections)
    .where(and(eq(agentConnections.grantId, record.grantId), isNull(agentConnections.revokedAt)));
  if (!connection || connection.userId !== record.payload.accountId) return null;

  // The token's own scope list is the authority; the connection row is for display.
  const scopes = String(record.payload.scope ?? '').split(' ').filter(isScope);
  if (scopes.length === 0) return null;

  // "Last used" is for the agents page; once a minute is precise enough.
  await ctx.db
    .update(agentConnections)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(agentConnections.id, connection.id),
        sql`(${agentConnections.lastUsedAt} is null or ${agentConnections.lastUsedAt} < now() - interval '1 minute')`,
      ),
    );

  return {
    userId: connection.userId,
    connectionId: connection.id,
    clientId: connection.clientId,
    scopes,
    expiresAt: Math.floor(record.expiresAt.getTime() / 1000),
  };
}

// --- Activity log --------------------------------------------------------------

export type ActivityOutcome = (typeof schema.activityOutcome.enumValues)[number];

export interface ActivityEntry {
  userId: string;
  connectionId: string;
  tool: string;
  requiredScope?: Scope | null;
  outcome: ActivityOutcome;
  /** What was touched, by name and id only. Values are never written here. */
  entityType?: string;
  entityId?: string;
  changedFields?: string[];
  durationMs: number;
}

export async function logActivity(ctx: DbOnly, entry: ActivityEntry): Promise<void> {
  await ctx.db.insert(agentActivity).values({
    ...entry,
    requiredScope: entry.requiredScope ?? null,
    durationMs: Math.max(0, Math.round(entry.durationMs)),
  });
}

export async function listActivity(
  ctx: DbOnly,
  userId: string,
  options: { connectionId?: string; outcome?: ActivityOutcome; limit?: number } = {},
) {
  return ctx.db
    .select()
    .from(agentActivity)
    .where(
      and(
        eq(agentActivity.userId, userId),
        options.connectionId ? eq(agentActivity.connectionId, options.connectionId) : undefined,
        options.outcome ? eq(agentActivity.outcome, options.outcome) : undefined,
      ),
    )
    .orderBy(desc(agentActivity.id))
    .limit(Math.min(options.limit ?? 50, 200));
}

export const ACTIVITY_OUTCOMES = schema.activityOutcome.enumValues;

// --- Rate limits ---------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets; what to send as Retry-After. */
  retryAfterSeconds: number;
}

/**
 * Counts one attempt against `key` and says whether it is within `limit` per window.
 * A single statement, so two servers (or two requests) cannot both slip under the limit.
 */
export async function hitRateLimit(ctx: DbOnly, key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const expired = sql`${rateLimits.windowStart} <= now() - make_interval(secs => ${windowSeconds})`;
  const result = await ctx.db.execute<{ count: number; retry: string }>(sql`
    insert into ${rateLimits} (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when ${expired} then 1 else ${rateLimits.count} + 1 end,
      window_start = case when ${expired} then now() else ${rateLimits.windowStart} end
    returning count, ceil(extract(epoch from (window_start + make_interval(secs => ${windowSeconds}) - now()))) as retry`);
  const row = result.rows[0]!;
  return { allowed: row.count <= limit, retryAfterSeconds: Math.max(1, Number(row.retry)) };
}

// --- Safe retries --------------------------------------------------------------

const IDEMPOTENCY_TTL_HOURS = 24;

/**
 * Runs a write at most once per key. If the agent repeats the call with the same
 * key (say its connection dropped before the answer arrived), it gets the first
 * answer back instead of a second write.
 */
export async function idempotent<T>(
  ctx: Ctx,
  call: { userId: string; connectionId: string; key: string | undefined; tool: string; args: unknown },
  run: () => Promise<T>,
): Promise<T> {
  if (!call.key) return run();
  const { userId, connectionId, key, tool } = call;
  const requestHash = createHash('sha256').update(JSON.stringify(call.args)).digest('base64url');
  const aad = `idempotency_keys:${userId}:${connectionId}:${key}`;
  const where = and(eq(idempotencyKeys.connectionId, connectionId), eq(idempotencyKeys.key, key));

  await ctx.db.delete(idempotencyKeys).where(and(where, lt(idempotencyKeys.expiresAt, sql`now()`)));
  const claimed = await ctx.db
    .insert(idempotencyKeys)
    .values({
      connectionId,
      key,
      tool,
      requestHash,
      expiresAt: sql`now() + make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})`,
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });

  if (claimed.length === 0) {
    const [existing] = await ctx.db.select().from(idempotencyKeys).where(where);
    if (!existing) throw new ConflictError('That request is being retried too quickly; try again');
    if (existing.tool !== tool || existing.requestHash !== requestHash) {
      throw new ConflictError('This idempotency_key was already used for a different request; use a new key');
    }
    if (existing.response === null) throw new ConflictError('The first request with this idempotency_key is still running; try again shortly');
    return openJson<T>(await getUserKey(ctx, userId), aad, existing.response);
  }

  try {
    const result = await run();
    await ctx.db
      .update(idempotencyKeys)
      .set({ response: sealJson(await getUserKey(ctx, userId), aad, result) })
      .where(where);
    return result;
  } catch (error) {
    // A failed attempt leaves nothing behind, so the agent can fix its input and reuse the key.
    await ctx.db.delete(idempotencyKeys).where(where);
    throw error;
  }
}
