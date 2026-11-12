import { eq, schema } from '@fin/db';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyProfileChanges,
  authenticateToken,
  checkInVariance,
  ConflictError,
  getPlanVersion,
  getProfile,
  getProgress,
  hashToken,
  hitRateLimit,
  idempotent,
  listActivity,
  listConnections,
  listItems,
  logActivity,
  markGrantRevoked,
  NotFoundError,
  recordConsent,
  revokeConnection,
  savePlanVersion,
  setupProfile,
  upsertItem,
  USER,
  type Actor,
} from '../src';
import { createUser, testCtx } from './helpers';

const ctx = testCtx();
const MCP = 'https://mcp.example.test/mcp';
let alice: string;
let bob: string;

beforeAll(async () => {
  alice = await createUser(ctx);
  bob = await createUser(ctx);
  await setupProfile(ctx, alice, { country: 'KE', currency: 'KES' });
  await setupProfile(ctx, bob, { country: 'US', currency: 'USD' });
});
afterAll(() => ctx.close());

/** Stands in for the OAuth server: stores an access token the way its adapter does. */
async function issueToken(input: { userId: string; grantId: string; scope: string; aud?: string; expiresInSeconds?: number }) {
  const token = randomBytes(32).toString('base64url');
  await ctx.db.insert(schema.oauthRecords).values({
    model: 'AccessToken',
    id: hashToken(token),
    grantId: input.grantId,
    payload: { accountId: input.userId, grantId: input.grantId, scope: input.scope, aud: input.aud ?? MCP, clientId: 'client-1' },
    expiresAt: new Date(Date.now() + (input.expiresInSeconds ?? 900) * 1000),
  });
  return token;
}

async function connect(userId: string, scopes: string[], clientId = `client-${randomUUID()}`) {
  const grantId = randomUUID();
  const connectionId = await recordConsent(ctx, { userId, clientId, clientName: 'Test App', grantId, scopes });
  return { grantId, connectionId, clientId };
}

describe('connections and tokens', () => {
  it('accepts a live token and reports who it belongs to', async () => {
    const { grantId, connectionId } = await connect(alice, ['finance:read']);
    const token = await issueToken({ userId: alice, grantId, scope: 'finance:read' });
    const auth = await authenticateToken(ctx, token, MCP);
    expect(auth).toMatchObject({ userId: alice, connectionId, scopes: ['finance:read'] });
    expect(auth!.expiresAt).toBeGreaterThan(Date.now() / 1000);
    const [listed] = await listConnections(ctx, alice);
    expect(listed!.lastUsedAt).not.toBeNull();
  });

  it('never stores the token itself', async () => {
    const { grantId } = await connect(alice, ['finance:read']);
    const token = await issueToken({ userId: alice, grantId, scope: 'finance:read' });
    const rows = await ctx.db.select().from(schema.oauthRecords).where(eq(schema.oauthRecords.grantId, grantId));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('rejects unknown, expired and wrong-audience tokens', async () => {
    const { grantId } = await connect(alice, ['finance:read']);
    expect(await authenticateToken(ctx, 'not-a-token', MCP)).toBeNull();
    expect(await authenticateToken(ctx, '', MCP)).toBeNull();
    const expired = await issueToken({ userId: alice, grantId, scope: 'finance:read', expiresInSeconds: -5 });
    expect(await authenticateToken(ctx, expired, MCP)).toBeNull();
    const elsewhere = await issueToken({ userId: alice, grantId, scope: 'finance:read', aud: 'https://other.example/mcp' });
    expect(await authenticateToken(ctx, elsewhere, MCP)).toBeNull();
  });

  it('rejects a token whose grant has no connection, or belongs to someone else', async () => {
    const orphan = await issueToken({ userId: alice, grantId: randomUUID(), scope: 'finance:read' });
    expect(await authenticateToken(ctx, orphan, MCP)).toBeNull();
    const { grantId } = await connect(bob, ['finance:read']);
    const forged = await issueToken({ userId: alice, grantId, scope: 'finance:read' });
    expect(await authenticateToken(ctx, forged, MCP)).toBeNull();
  });

  it('ignores scopes it does not know and refuses a token with none', async () => {
    const { grantId } = await connect(alice, ['finance:read', 'finance:write']);
    const mixed = await issueToken({ userId: alice, grantId, scope: 'finance:write admin:everything' });
    expect((await authenticateToken(ctx, mixed, MCP))!.scopes).toEqual(['finance:write']);
    const none = await issueToken({ userId: alice, grantId, scope: 'openid' });
    expect(await authenticateToken(ctx, none, MCP)).toBeNull();
  });

  it('revoking cuts access at once and removes the tokens', async () => {
    const { grantId, connectionId } = await connect(alice, ['finance:read']);
    const token = await issueToken({ userId: alice, grantId, scope: 'finance:read' });
    await expect(revokeConnection(ctx, bob, connectionId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await authenticateToken(ctx, token, MCP)).not.toBeNull();
    await revokeConnection(ctx, alice, connectionId);
    expect(await authenticateToken(ctx, token, MCP)).toBeNull();
    expect(await ctx.db.select().from(schema.oauthRecords).where(eq(schema.oauthRecords.grantId, grantId))).toHaveLength(0);
    expect((await listConnections(ctx, alice)).find((c) => c.id === connectionId)!.revokedAt).not.toBeNull();
  });

  it('connecting the same app again replaces the earlier connection', async () => {
    const first = await connect(alice, ['finance:read'], 'client-same');
    const oldToken = await issueToken({ userId: alice, grantId: first.grantId, scope: 'finance:read' });
    const second = await connect(alice, ['finance:read', 'finance:write'], 'client-same');
    expect(await authenticateToken(ctx, oldToken, MCP)).toBeNull();
    const live = (await listConnections(ctx, alice)).filter((c) => c.clientId === 'client-same' && !c.revokedAt);
    expect(live.map((c) => c.id)).toEqual([second.connectionId]);
  });

  it('a grant withdrawn by the OAuth server shows as revoked', async () => {
    const { grantId, connectionId } = await connect(alice, ['finance:read']);
    await markGrantRevoked(ctx, grantId);
    expect((await listConnections(ctx, alice)).find((c) => c.id === connectionId)!.revokedAt).not.toBeNull();
  });

  it('cleans up the name an app gives itself and needs a known permission', async () => {
    const grantId = randomUUID();
    await recordConsent(ctx, { userId: bob, clientId: 'c-name', clientName: `Evil\u0000\u001b[31m ${'x'.repeat(200)}`, grantId, scopes: ['finance:read'] });
    const [row] = (await listConnections(ctx, bob)).filter((c) => c.clientId === 'c-name');
    expect(row!.clientName).toHaveLength(80);
    expect(row!.clientName).not.toMatch(/[\u0000-\u001f]/);
    await expect(recordConsent(ctx, { userId: bob, clientId: 'c2', grantId: randomUUID(), scopes: ['admin'] })).rejects.toThrow();
  });
});

describe('activity log', () => {
  it('records calls per user and filters by connection', async () => {
    const a = await connect(alice, ['finance:read']);
    const b = await connect(bob, ['finance:read']);
    await logActivity(ctx, { userId: alice, connectionId: a.connectionId, tool: 'get_profile', requiredScope: 'finance:read', outcome: 'ok', durationMs: 12.4 });
    await logActivity(ctx, { userId: alice, connectionId: a.connectionId, tool: 'update_goal', requiredScope: 'finance:write', outcome: 'denied', durationMs: 1 });
    await logActivity(ctx, { userId: bob, connectionId: b.connectionId, tool: 'get_profile', outcome: 'ok', durationMs: 3 });
    const mine = await listActivity(ctx, alice, { connectionId: a.connectionId });
    expect(mine.map((r) => [r.tool, r.outcome])).toEqual([['update_goal', 'denied'], ['get_profile', 'ok']]);
    expect((await listActivity(ctx, bob, { connectionId: a.connectionId }))).toHaveLength(0);
  });
});

describe('rate limits', () => {
  it('allows up to the limit, then refuses with a wait time', async () => {
    const key = `test:${randomUUID()}`;
    for (let i = 0; i < 3; i++) expect((await hitRateLimit(ctx, key, 3, 60)).allowed).toBe(true);
    const over = await hitRateLimit(ctx, key, 3, 60);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
    expect(over.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('starts counting again when the window has passed', async () => {
    const key = `test:${randomUUID()}`;
    await hitRateLimit(ctx, key, 1, 60);
    expect((await hitRateLimit(ctx, key, 1, 60)).allowed).toBe(false);
    await ctx.db.update(schema.rateLimits).set({ windowStart: new Date(Date.now() - 61_000) }).where(eq(schema.rateLimits.key, key));
    expect((await hitRateLimit(ctx, key, 1, 60)).allowed).toBe(true);
  });

  it('counts concurrent attempts exactly', async () => {
    const key = `test:${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => hitRateLimit(ctx, key, 5, 60)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});

describe('safe retries', () => {
  it('runs a keyed write once and replays the first answer', async () => {
    const { connectionId } = await connect(alice, ['finance:write']);
    let runs = 0;
    const call = { userId: alice, connectionId, key: 'k1', tool: 'create_goal', args: { title: 'A' } };
    const run = async () => ({ goalId: `g-${++runs}`, amount: 777123 });
    expect(await idempotent(ctx, call, run)).toEqual({ goalId: 'g-1', amount: 777123 });
    expect(await idempotent(ctx, call, run)).toEqual({ goalId: 'g-1', amount: 777123 });
    expect(runs).toBe(1);
    // The remembered answer is encrypted at rest.
    const [row] = await ctx.db.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.connectionId, connectionId));
    expect(row!.response).not.toContain('777123');
  });

  it('refuses a key reused for a different request', async () => {
    const { connectionId } = await connect(alice, ['finance:write']);
    const base = { userId: alice, connectionId, key: 'k2', tool: 'create_goal' };
    await idempotent(ctx, { ...base, args: { title: 'A' } }, async () => 1);
    await expect(idempotent(ctx, { ...base, args: { title: 'B' } }, async () => 2)).rejects.toBeInstanceOf(ConflictError);
    await expect(idempotent(ctx, { ...base, tool: 'update_goal', args: { title: 'A' } }, async () => 3)).rejects.toBeInstanceOf(ConflictError);
  });

  it('forgets a failed attempt, runs unkeyed calls every time, and keeps keys per connection', async () => {
    const one = await connect(alice, ['finance:write']);
    const two = await connect(alice, ['finance:write']);
    const call = { userId: alice, connectionId: one.connectionId, key: 'k3', tool: 't', args: {} };
    await expect(idempotent(ctx, call, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await idempotent(ctx, call, async () => 'second try')).toBe('second try');
    expect(await idempotent(ctx, { ...call, connectionId: two.connectionId }, async () => 'other app')).toBe('other app');
    let runs = 0;
    const unkeyed = { ...call, key: undefined };
    await idempotent(ctx, unkeyed, async () => ++runs);
    await idempotent(ctx, unkeyed, async () => ++runs);
    expect(runs).toBe(2);
  });

  it('runs only one of two simultaneous calls with the same key', async () => {
    const { connectionId } = await connect(alice, ['finance:write']);
    let runs = 0;
    const call = { userId: alice, connectionId, key: 'k4', tool: 't', args: {} };
    const slow = async () => { runs++; await new Promise((r) => setTimeout(r, 80)); return 'done'; };
    const results = await Promise.allSettled([idempotent(ctx, call, slow), idempotent(ctx, call, slow)]);
    expect(runs).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('batched profile changes', () => {
  const AGENT: Actor = { type: 'agent', connectionId: null };
  const salary = { kind: 'income', label: 'Salary', amountMinor: 500_000, frequency: 'monthly' } as const;

  it('applies several changes as one revision', async () => {
    const user = await createUser(ctx);
    await setupProfile(ctx, user, { country: 'KE', currency: 'KES' });
    const { result: oldId } = await upsertItem(ctx, user, USER, { kind: 'expense', label: 'Gym', amountMinor: 3000, frequency: 'monthly', category: 'personal', essential: false });
    await applyProfileChanges(ctx, user, USER, { details: { householdSize: 3, notes: 'keep me' } });
    const before = (await getProfile(ctx, user))!.revision;

    const { revision, result } = await applyProfileChanges(
      ctx, user, AGENT,
      { details: { payFrequency: 'monthly' }, changes: [{ op: 'upsert', item: salary }, { op: 'archive', id: oldId }] },
      { expectedRevision: before },
    );
    expect(revision).toBe(before + 1);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]!.kind).toBe('income');
    expect(result.archived).toEqual([oldId]);
    expect(result.details).toEqual(['payFrequency']);
    const profile = (await getProfile(ctx, user))!;
    // Details that were not mentioned are kept.
    expect(profile).toMatchObject({ payFrequency: 'monthly', householdSize: 3, notes: 'keep me' });
    expect((await listItems(ctx, user)).map((i) => i.label)).toEqual(['Salary']);
    // One snapshot for the agent's whole batch.
    const snapshots = await ctx.db.select().from(schema.profileRevisions).where(eq(schema.profileRevisions.userId, user));
    expect(snapshots.map((s) => s.revision)).toEqual([before]);
  });

  it('changes nothing when any part fails', async () => {
    const user = await createUser(ctx);
    await setupProfile(ctx, user, { country: 'KE', currency: 'KES' });
    const before = (await getProfile(ctx, user))!.revision;
    await expect(
      applyProfileChanges(ctx, user, AGENT, { changes: [{ op: 'upsert', item: salary }, { op: 'archive', id: randomUUID() }] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await listItems(ctx, user)).toHaveLength(0);
    expect((await getProfile(ctx, user))!.revision).toBe(before);
    await expect(applyProfileChanges(ctx, user, AGENT, { changes: [{ op: 'upsert', item: salary }] }, { expectedRevision: before + 5 })).rejects.toBeInstanceOf(ConflictError);
  });

  it("cannot touch another user's item", async () => {
    const { result: bobsItem } = await upsertItem(ctx, bob, USER, salary);
    await expect(applyProfileChanges(ctx, alice, AGENT, { changes: [{ op: 'archive', id: bobsItem }] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(applyProfileChanges(ctx, alice, AGENT, { changes: [{ op: 'upsert', id: bobsItem, item: salary }] })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('check-in comparison and progress', () => {
  it('scales the monthly plan to the period and reports differences', async () => {
    const user = await createUser(ctx);
    await setupProfile(ctx, user, { country: 'KE', currency: 'KES' });
    await upsertItem(ctx, user, USER, { kind: 'income', label: 'Salary', amountMinor: 365_250, frequency: 'monthly' });
    const { version } = await savePlanVersion(ctx, user, USER, {
      summary: 'Plan',
      inputs: { budget: [{ category: 'food', amountMinor: 36_525 }, { category: 'housing', amountMinor: 73_050 }] },
    });
    const plan = await getPlanVersion(ctx, user, version);
    // 365.25 / 12 = 30.4375 days in a month, so a 14-day period is 14 / 30.4375 of the plan.
    const variance = checkInVariance(
      { periodStart: '2026-03-01', periodEnd: '2026-03-14', actuals: { incomeMinor: 170_000, spending: [{ category: 'food', amountMinor: 20_000 }, { category: 'giving', amountMinor: 500 }], debtPaymentsMinor: 0, savingsAddedMinor: 0 } },
      plan,
    )!;
    expect(variance.periodDays).toBe(14);
    expect(variance.income).toEqual({ plannedMinor: 168_000, actualMinor: 170_000, differenceMinor: 2_000 });
    expect(variance.spending).toEqual([
      { category: 'food', plannedMinor: 16_800, actualMinor: 20_000, differenceMinor: 3_200 },
      { category: 'giving', plannedMinor: 0, actualMinor: 500, differenceMinor: 500 },
      { category: 'housing', plannedMinor: 33_600, actualMinor: 0, differenceMinor: -33_600 },
    ]);

    const progress = await getProgress(ctx, user);
    expect(progress.plan).toMatchObject({ versions: 1, currentVersion: 1 });
    expect(progress.checkIns.count).toBe(0);
    expect(progress.lessons).toEqual({ assigned: 0, completed: 0, quizzes: [] });
  });
});
