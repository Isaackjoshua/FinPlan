import { eq, schema } from '@fin/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  archiveItem,
  ConflictError,
  createGoal,
  DecryptionError,
  getCurrentPlan,
  getPlanVersion,
  getProfile,
  listCheckIns,
  listGoals,
  listItems,
  listPlanVersions,
  logCheckIn,
  NotFoundError,
  openJson,
  revertToVersion,
  savePlanVersion,
  setupProfile,
  updateGoal,
  updateProfileDetails,
  upsertItem,
  USER,
  getUserKey,
  type Actor,
} from '../src';
import { createUser, testCtx } from './helpers';

const ctx = testCtx();
const AGENT: Actor = { type: 'agent', connectionId: null };
let alice: string;
let bob: string;

beforeAll(async () => {
  alice = await createUser(ctx);
  bob = await createUser(ctx);
  await setupProfile(ctx, alice, { country: 'KE', currency: 'KES' });
  await setupProfile(ctx, bob, { country: 'US', currency: 'USD' });
});
afterAll(() => ctx.close());

const rent = { kind: 'expense', label: 'Rent SENTINEL-4242', amountMinor: 4242421, frequency: 'monthly', category: 'housing', essential: true } as const;
const planInput = (summary: string) => ({
  summary,
  inputs: { budget: [{ category: 'housing' as const, amountMinor: 4000000 }], debtStrategy: 'avalanche' as const },
});

describe('profile', () => {
  it('is created once and keeps its currency', async () => {
    await setupProfile(ctx, alice, { country: 'US', currency: 'USD' });
    expect(await getProfile(ctx, alice)).toMatchObject({ country: 'KE', currency: 'KES', revision: 1 });
  });

  it('rejects invalid input before touching the database', async () => {
    await expect(setupProfile(ctx, alice, { country: 'Kenya', currency: 'KES' })).rejects.toThrow();
    await expect(upsertItem(ctx, alice, USER, { ...rent, amountMinor: -1 })).rejects.toThrow();
    await expect(upsertItem(ctx, alice, USER, { ...rent, amountMinor: 1.5 })).rejects.toThrow();
    await expect(upsertItem(ctx, alice, USER, { ...rent, label: '' })).rejects.toThrow();
    expect((await getProfile(ctx, alice))!.revision).toBe(1);
  });

  it('stores items encrypted and bumps the revision', async () => {
    const { revision, result: id } = await upsertItem(ctx, alice, USER, rent);
    expect(revision).toBe(2);
    expect(await listItems(ctx, alice, 'expense')).toEqual([{ ...rent, id }]);

    const [row] = await ctx.db.select().from(schema.profileItems).where(eq(schema.profileItems.id, id));
    expect(row!.data).not.toContain('SENTINEL');
    expect(row!.data).not.toContain('4242421');
  });

  it('strips control characters from text', async () => {
    const { result: id } = await upsertItem(ctx, alice, USER, { kind: 'income', label: ' Sal\u0000ary\u0007 ', amountMinor: 1, frequency: 'monthly' });
    expect((await listItems(ctx, alice, 'income')).find((i) => i.id === id)!.label).toBe('Salary');
  });

  it('updates and archives items', async () => {
    const { result: id } = await upsertItem(ctx, alice, USER, { kind: 'savings', label: 'Pot', balanceMinor: 10, apyBps: 0, isEmergencyFund: false });
    await upsertItem(ctx, alice, USER, { id, kind: 'savings', label: 'Pot', balanceMinor: 99, apyBps: 0, isEmergencyFund: true });
    expect(await listItems(ctx, alice, 'savings')).toEqual([{ id, kind: 'savings', label: 'Pot', balanceMinor: 99, apyBps: 0, isEmergencyFund: true }]);
    await archiveItem(ctx, alice, USER, id);
    expect(await listItems(ctx, alice, 'savings')).toEqual([]);
    await expect(archiveItem(ctx, alice, USER, id)).rejects.toThrow(NotFoundError);
  });

  it('rejects a write based on a stale revision', async () => {
    const { revision } = (await getProfile(ctx, alice))!;
    await updateProfileDetails(ctx, alice, USER, { householdSize: 3 }, { expectedRevision: revision });
    await expect(updateProfileDetails(ctx, alice, USER, { householdSize: 9 }, { expectedRevision: revision })).rejects.toThrow(ConflictError);
    expect((await getProfile(ctx, alice))!.householdSize).toBe(3);
  });

  it('snapshots the previous state before an agent write, but not before a user write', async () => {
    const before = (await getProfile(ctx, alice))!;
    const itemsBefore = await listItems(ctx, alice);
    await upsertItem(ctx, alice, AGENT, { kind: 'income', label: 'Agent-added', amountMinor: 5, frequency: 'weekly' });
    await upsertItem(ctx, alice, USER, { kind: 'income', label: 'User-added', amountMinor: 5, frequency: 'weekly' });

    const snapshots = await ctx.db.select().from(schema.profileRevisions).where(eq(schema.profileRevisions.userId, alice));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ revision: before.revision, actorType: 'agent' });
    const key = await getUserKey(ctx, alice);
    const snapshot = openJson<{ items: unknown[] }>(key, `profile_revisions:${alice}:${before.revision}`, snapshots[0]!.data);
    expect(snapshot.items).toEqual(itemsBefore);
  });
});

describe('goals', () => {
  it('creates and updates', async () => {
    const { result: id } = await createGoal(ctx, alice, USER, { kind: 'emergency_fund', title: 'Three months', targetAmountMinor: 900000 });
    const { result: changed } = await updateGoal(ctx, alice, AGENT, id, { currentAmountMinor: 100000, status: 'paused' });
    expect(changed.sort()).toEqual(['currentAmountMinor', 'status']);
    expect(await listGoals(ctx, alice)).toEqual([
      { id, kind: 'emergency_fund', title: 'Three months', targetAmountMinor: 900000, currentAmountMinor: 100000, priority: 3, status: 'paused' },
    ]);
  });
});

describe('isolation between users', () => {
  it("never returns another user's data", async () => {
    expect(await listItems(ctx, bob)).toEqual([]);
    expect(await listGoals(ctx, bob)).toEqual([]);
  });

  it("cannot change another user's rows even with the right id", async () => {
    const [item] = await listItems(ctx, alice, 'expense');
    const [goal] = await listGoals(ctx, alice);
    await expect(upsertItem(ctx, bob, USER, { ...rent, id: item!.id, label: 'hijack' })).rejects.toThrow(NotFoundError);
    await expect(archiveItem(ctx, bob, USER, item!.id)).rejects.toThrow(NotFoundError);
    await expect(updateGoal(ctx, bob, USER, goal!.id, { title: 'hijack' })).rejects.toThrow(NotFoundError);
    expect((await listItems(ctx, alice, 'expense'))[0]!.label).toBe(rent.label);
    // A failed write rolls back: Bob's revision did not move.
    expect((await getProfile(ctx, bob))!.revision).toBe(1);
  });

  it('cannot read a ciphertext copied into its own row', async () => {
    const [aliceRow] = await ctx.db.select().from(schema.profileItems).where(eq(schema.profileItems.userId, alice)).limit(1);
    await ctx.db.insert(schema.profileItems).values({ userId: bob, kind: aliceRow!.kind, data: aliceRow!.data });
    await expect(listItems(ctx, bob)).rejects.toThrow(DecryptionError);
    await ctx.db.delete(schema.profileItems).where(eq(schema.profileItems.userId, bob));
  });
});

describe('plans', () => {
  it('has no plan to begin with', async () => {
    expect(await getCurrentPlan(ctx, alice)).toBeNull();
    expect(await listPlanVersions(ctx, alice)).toEqual([]);
  });

  it('numbers versions and makes the newest current', async () => {
    expect(await savePlanVersion(ctx, alice, USER, planInput('First plan'))).toEqual({ version: 1 });
    expect(await savePlanVersion(ctx, alice, AGENT, planInput('Agent rewrite'))).toEqual({ version: 2 });
    const current = await getCurrentPlan(ctx, alice);
    expect(current).toMatchObject({ version: 2, summary: 'Agent rewrite', savedBy: 'agent', isCurrent: true });
    expect(current!.inputs).toMatchObject({ debtStrategy: 'avalanche', emergencyFundMonths: 3, extraDebtPaymentMinor: 0 });
  });

  it('reverts by moving the pointer, keeping every version', async () => {
    await revertToVersion(ctx, alice, 1);
    expect(await getCurrentPlan(ctx, alice)).toMatchObject({ version: 1, summary: 'First plan' });
    expect((await listPlanVersions(ctx, alice)).map((v) => [v.version, v.isCurrent])).toEqual([[2, false], [1, true]]);
    expect(await getPlanVersion(ctx, alice, 2)).toMatchObject({ summary: 'Agent rewrite' });

    // A revert can itself be undone, and a new save continues the numbering.
    await revertToVersion(ctx, alice, 2);
    expect((await getCurrentPlan(ctx, alice))!.version).toBe(2);
    await revertToVersion(ctx, alice, 1);
    expect(await savePlanVersion(ctx, alice, USER, planInput('Third'))).toEqual({ version: 3 });
  });

  it('records who made which version current', async () => {
    const events = await ctx.db.select().from(schema.planEvents).where(eq(schema.planEvents.userId, alice)).orderBy(schema.planEvents.createdAt);
    expect(events.map((e) => [e.kind, e.fromVersion, e.toVersion, e.actorType])).toEqual([
      ['saved', null, 1, 'user'],
      ['saved', 1, 2, 'agent'],
      ['reverted', 2, 1, 'user'],
      ['reverted', 1, 2, 'user'],
      ['reverted', 2, 1, 'user'],
      ['saved', 1, 3, 'user'],
    ]);
  });

  it('rejects a save based on a stale version', async () => {
    await expect(savePlanVersion(ctx, alice, AGENT, { ...planInput('Stale'), baseVersion: 1 })).rejects.toThrow(ConflictError);
    expect(await savePlanVersion(ctx, alice, AGENT, { ...planInput('Fresh'), baseVersion: 3 })).toEqual({ version: 4 });
  });

  it('gives concurrent saves distinct version numbers', async () => {
    const saved = await Promise.all([1, 2, 3, 4, 5].map((n) => savePlanVersion(ctx, bob, USER, planInput(`Race ${n}`))));
    expect(saved.map((s) => s.version).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('refuses to rewrite a saved version, even with direct database access', async () => {
    await expect(
      ctx.db.update(schema.planVersions).set({ data: 'x' }).where(eq(schema.planVersions.userId, alice)),
    ).rejects.toThrow();
    expect(await getPlanVersion(ctx, alice, 1)).toMatchObject({ summary: 'First plan' });
  });

  it("cannot see or revert to another user's versions", async () => {
    const carol = await createUser(ctx);
    expect(await listPlanVersions(ctx, carol)).toEqual([]);
    await expect(revertToVersion(ctx, carol, 1)).rejects.toThrow(NotFoundError);
    await expect(getPlanVersion(ctx, carol, 1)).rejects.toThrow(NotFoundError);
  });
});

describe('check-ins', () => {
  it('logs against the current plan and lists newest first', async () => {
    const actuals = { incomeMinor: 500, spending: [{ category: 'food' as const, amountMinor: 120 }], debtPaymentsMinor: 0, savingsAddedMinor: 50 };
    await logCheckIn(ctx, alice, USER, { periodStart: '2026-09-01', periodEnd: '2026-09-30', actuals });
    await logCheckIn(ctx, alice, AGENT, { periodStart: '2026-10-01', periodEnd: '2026-10-31', actuals, note: 'On track' });
    const list = await listCheckIns(ctx, alice);
    expect(list.map((c) => [c.periodEnd, c.loggedBy, c.note])).toEqual([
      ['2026-10-31', 'agent', 'On track'],
      ['2026-09-30', 'user', undefined],
    ]);
    expect(list[0]!.actuals).toEqual(actuals);
    expect(await listCheckIns(ctx, bob)).toEqual([]);
  });

  it('rejects a period that ends before it starts', async () => {
    await expect(
      logCheckIn(ctx, alice, USER, { periodStart: '2026-10-31', periodEnd: '2026-10-01', actuals: { incomeMinor: 0, spending: [] } }),
    ).rejects.toThrow();
  });
});
