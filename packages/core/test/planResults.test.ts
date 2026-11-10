import { afterAll, describe, expect, it } from 'vitest';
import { computePlanResults, createGoal, getCurrentPlan, planInputs, savePlanVersion, setupProfile, upsertItem, USER, type Goal, type Item } from '../src';
import { createUser, testCtx } from './helpers';

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';

const items: Item[] = [
  { id: 'i1', kind: 'income', label: 'Salary', amountMinor: 500_000, frequency: 'monthly' },
  { id: 'e1', kind: 'expense', label: 'Rent', amountMinor: 150_000, frequency: 'monthly', category: 'housing', essential: true },
  { id: 'e2', kind: 'expense', label: 'Fun', amountMinor: 30_000, frequency: 'monthly', category: 'entertainment', essential: false },
  { id: 'd1', kind: 'debt', label: 'Card', debtKind: 'credit_card', balanceMinor: 100_000, aprBps: 1200, minimumPaymentMinor: 2500 },
  { id: 'd2', kind: 'debt', label: 'Cleared', debtKind: 'other', balanceMinor: 0, aprBps: 3000, minimumPaymentMinor: 0 },
  { id: 's1', kind: 'savings', label: 'Buffer', balanceMinor: 150_000, apyBps: 0, isEmergencyFund: true },
];
const goals: Goal[] = [
  { id: G1, kind: 'emergency_fund', title: 'Buffer', targetAmountMinor: 450_000, currentAmountMinor: 150_000, priority: 1, status: 'active' },
  { id: G2, kind: 'purchase', title: 'Laptop', targetAmountMinor: 90_000, currentAmountMinor: 0, priority: 3, status: 'paused' },
];
const inputs = (over: object = {}) =>
  planInputs.parse({
    budget: [{ category: 'housing', amountMinor: 150_000 }, { category: 'entertainment', amountMinor: 20_000 }],
    debtStrategy: 'avalanche',
    extraDebtPaymentMinor: 47_500,
    emergencyFundMonths: 3,
    goalContributions: [{ goalId: G1, amountMinor: 50_000 }],
    ...over,
  });

describe('computePlanResults', () => {
  it('works out where the money goes and when things are reached', () => {
    const r = computePlanResults(items, goals, inputs(), '2026-11');
    expect(r.engineVersion).toBe('1.0.0');
    expect(r.monthly).toEqual({
      incomeMinor: 500_000,
      budgetedSpendingMinor: 170_000,
      debtPaymentsMinor: 50_000, // 2,500 minimum + 47,500 extra
      goalContributionsMinor: 50_000,
      unallocatedMinor: 230_000,
    });
    // Same debt and payment as the engine's hand-worked example: three months, 15.25 interest.
    expect(r.debt!.avalanche).toMatchObject({ feasible: true, monthsToDebtFree: 3, debtFreeMonth: '2027-01', totalInterestMinor: 1525 });
    expect(r.debt!.avalanche).toMatchObject({ priorityOrder: ['d1'] });
    // Essentials are 150,000 a month; three months is 450,000; 300,000 to go at 50,000 a month.
    expect(r.emergencyFund).toEqual({ targetMinor: 450_000, gapMinor: 300_000, monthsCovered: 1, monthsToTarget: 6, targetReachedMonth: '2027-04' });
    expect(r.goals).toEqual([{ goalId: G1, monthsToTarget: 6, targetReachedMonth: '2027-04' }]);
    expect(r.budget.buckets.map((b) => [b.bucket, b.actualMinor])).toEqual([['needs', 150_000], ['wants', 20_000], ['savings', 330_000]]);
    expect(r.warnings).toEqual([]);
  });

  it('warns when the plan spends more than comes in', () => {
    const r = computePlanResults(items, goals, inputs({ budget: [{ category: 'housing', amountMinor: 450_000 }] }), '2026-11');
    expect(r.monthly.unallocatedMinor).toBe(-50_000);
    expect(r.warnings.map((w) => w.code)).toEqual(['plan_exceeds_income']);
  });

  it('leaves out contributions to goals that are paused or do not exist', () => {
    const r = computePlanResults(items, goals, inputs({ goalContributions: [{ goalId: G2, amountMinor: 10_000 }, { goalId: '33333333-3333-4333-8333-333333333333', amountMinor: 5 }] }), '2026-11');
    expect(r.goals).toEqual([]);
    expect(r.monthly.goalContributionsMinor).toBe(0);
    expect(r.emergencyFund).toMatchObject({ monthsToTarget: null });
    expect(r.warnings.map((w) => w.code)).toEqual(['goal_not_active']);
  });

  it('warns when the chosen strategy never clears the debt', () => {
    const big: Item[] = [...items, { id: 'd3', kind: 'debt', label: 'Loan', debtKind: 'personal_loan', balanceMinor: 50_000_000, aprBps: 3600, minimumPaymentMinor: 0 }];
    const r = computePlanResults(big, goals, inputs({ extraDebtPaymentMinor: 0 }), '2026-11');
    expect(r.warnings).toEqual([expect.objectContaining({ code: 'debt_never_cleared', message: expect.stringContaining('never paid off') })]);
  });

  it('has no debt section without debts, and no debt payments either', () => {
    const r = computePlanResults(items.filter((i) => i.kind !== 'debt'), goals, inputs(), '2026-11');
    expect(r.debt).toBeNull();
    expect(r.monthly.debtPaymentsMinor).toBe(0);
  });

  it('still compares strategies when none is chosen', () => {
    const r = computePlanResults(items, goals, inputs({ debtStrategy: undefined }), '2026-11');
    expect(r.debt!.difference).toEqual({ interestSavedByAvalancheMinor: 0, monthsSavedByAvalanche: 0 });
    expect(r.warnings).toEqual([]);
  });
});

describe('saving a plan', () => {
  const ctx = testCtx();
  afterAll(() => ctx.close());

  it('computes results from the stored profile and keeps them with the version', async () => {
    const user = await createUser(ctx);
    await setupProfile(ctx, user, { country: 'KE', currency: 'KES' });
    await upsertItem(ctx, user, USER, { kind: 'income', label: 'Salary', amountMinor: 500_000, frequency: 'monthly' });
    await upsertItem(ctx, user, USER, { kind: 'debt', label: 'Card', debtKind: 'credit_card', balanceMinor: 100_000, aprBps: 1200, minimumPaymentMinor: 2500 });
    const { result: goalId } = await createGoal(ctx, user, USER, { kind: 'purchase', title: 'Laptop', targetAmountMinor: 90_000 });

    const saved = await savePlanVersion(
      ctx, user, USER,
      { summary: 'Clear the card', inputs: { budget: [], debtStrategy: 'snowball', extraDebtPaymentMinor: 47_500, goalContributions: [{ goalId, amountMinor: 30_000 }] } },
      new Date('2026-11-10T12:00:00Z'),
    );
    expect(saved.results.debt!.snowball).toMatchObject({ debtFreeMonth: '2027-01', totalInterestMinor: 1525 });
    expect(saved.results.goals).toEqual([{ goalId, monthsToTarget: 3, targetReachedMonth: '2027-01' }]);

    const current = await getCurrentPlan(ctx, user);
    expect(current!.results).toEqual(saved.results);

    // A later profile change does not rewrite what an earlier version said.
    await upsertItem(ctx, user, USER, { kind: 'debt', label: 'New loan', debtKind: 'other', balanceMinor: 900_000, aprBps: 2000, minimumPaymentMinor: 0 });
    expect((await getCurrentPlan(ctx, user))!.results).toEqual(saved.results);
  });
});
