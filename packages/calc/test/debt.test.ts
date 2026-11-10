import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calcDebtPayoff, CalcError, compareDebtStrategies, type DebtInput, type DebtPayoffPlan } from '../src';

const startDate = '2026-11-10';
const plan = (r: unknown) => r as DebtPayoffPlan;

describe('calcDebtPayoff', () => {
  it('matches a hand-worked single debt', () => {
    // 1,000.00 at 12% a year (1% a month), paying 500.00 a month:
    //   month 1: 1,000.00 + 10.00 interest − 500.00 = 510.00
    //   month 2:   510.00 +  5.10 interest − 500.00 =  15.10
    //   month 3:    15.10 +  0.15 interest −  15.25 =   0.00
    const result = calcDebtPayoff({ debts: [{ id: 'card', balanceMinor: 100_000, aprBps: 1200, minimumPaymentMinor: 2500 }], monthlyBudgetMinor: 50_000, strategy: 'avalanche', startDate });
    expect(result).toEqual({
      strategy: 'avalanche',
      feasible: true,
      priorityOrder: ['card'],
      monthsToDebtFree: 3,
      debtFreeMonth: '2027-01',
      totalInterestMinor: 1525,
      totalPaidMinor: 101_525,
      debts: [{ id: 'card', paidOffInMonth: 3, paidOffMonth: '2027-01', interestMinor: 1525 }],
      schedule: [
        { month: 1, date: '2026-11', paymentMinor: 50_000, interestMinor: 1000, remainingMinor: 51_000 },
        { month: 2, date: '2026-12', paymentMinor: 50_000, interestMinor: 510, remainingMinor: 1510 },
        { month: 3, date: '2027-01', paymentMinor: 1525, interestMinor: 15, remainingMinor: 0 },
      ],
      scheduleTruncated: false,
    });
  });

  const two: DebtInput[] = [
    { id: 'small-cheap', balanceMinor: 50_000, aprBps: 500, minimumPaymentMinor: 1000 },
    { id: 'big-costly', balanceMinor: 200_000, aprBps: 2400, minimumPaymentMinor: 4000 },
  ];

  it('orders by balance for snowball and by rate for avalanche', () => {
    const snowball = plan(calcDebtPayoff({ debts: two, monthlyBudgetMinor: 20_000, strategy: 'snowball', startDate }));
    const avalanche = plan(calcDebtPayoff({ debts: two, monthlyBudgetMinor: 20_000, strategy: 'avalanche', startDate }));
    expect(snowball.priorityOrder).toEqual(['small-cheap', 'big-costly']);
    expect(avalanche.priorityOrder).toEqual(['big-costly', 'small-cheap']);
    expect(snowball.debts[0]!.paidOffInMonth).toBeLessThan(avalanche.debts[0]!.paidOffInMonth);
    expect(avalanche.totalInterestMinor).toBeLessThan(snowball.totalInterestMinor);
  });

  it('rolls a cleared debt\'s payment on to the next, keeping the monthly total constant', () => {
    const result = plan(calcDebtPayoff({ debts: two, monthlyBudgetMinor: 20_000, strategy: 'snowball', startDate }));
    const full = result.schedule.slice(0, -1);
    expect(full.every((row) => row.paymentMinor === 20_000)).toBe(true);
  });

  it('breaks ties by the other rule, then by id', () => {
    const tied: DebtInput[] = [
      { id: 'b', balanceMinor: 1000, aprBps: 1000, minimumPaymentMinor: 0 },
      { id: 'a', balanceMinor: 1000, aprBps: 1000, minimumPaymentMinor: 0 },
      { id: 'c', balanceMinor: 1000, aprBps: 2000, minimumPaymentMinor: 0 },
      { id: 'd', balanceMinor: 500, aprBps: 1000, minimumPaymentMinor: 0 },
    ];
    expect(plan(calcDebtPayoff({ debts: tied, monthlyBudgetMinor: 100, strategy: 'snowball', startDate })).priorityOrder).toEqual(['d', 'c', 'a', 'b']);
    expect(plan(calcDebtPayoff({ debts: tied, monthlyBudgetMinor: 100, strategy: 'avalanche', startDate })).priorityOrder).toEqual(['c', 'd', 'a', 'b']);
  });

  it('treats no debts, and debts already at zero, as nothing to pay', () => {
    expect(calcDebtPayoff({ debts: [], monthlyBudgetMinor: 0, strategy: 'snowball', startDate })).toMatchObject({ feasible: true, monthsToDebtFree: 0, debtFreeMonth: null, schedule: [], scheduleTruncated: false });
    const result = plan(calcDebtPayoff({ debts: [{ id: 'done', balanceMinor: 0, aprBps: 2000, minimumPaymentMinor: 500 }, { id: 'open', balanceMinor: 100, aprBps: 0, minimumPaymentMinor: 50 }], monthlyBudgetMinor: 50, strategy: 'snowball', startDate }));
    expect(result.priorityOrder).toEqual(['open']);
    expect(result.debts).toEqual([
      { id: 'done', paidOffInMonth: 0, paidOffMonth: null, interestMinor: 0 },
      { id: 'open', paidOffInMonth: 2, paidOffMonth: '2026-12', interestMinor: 0 },
    ]);
  });

  it('says so when the budget cannot cover the minimum payments', () => {
    expect(calcDebtPayoff({ debts: two, monthlyBudgetMinor: 4999, strategy: 'avalanche', startDate })).toEqual({
      strategy: 'avalanche', feasible: false, reason: 'budget_below_minimums', minimumBudgetMinor: 5000,
    });
  });

  it('counts first-month interest when a minimum is larger than the balance', () => {
    // Owes 100.00 at 60%: the first payment must clear 105.00, not 100.00.
    const debts = [{ id: 'x', balanceMinor: 10_000, aprBps: 6000, minimumPaymentMinor: 20_000 }];
    expect(calcDebtPayoff({ debts, monthlyBudgetMinor: 10_000, strategy: 'snowball', startDate })).toMatchObject({ feasible: false, minimumBudgetMinor: 10_500 });
    expect(calcDebtPayoff({ debts, monthlyBudgetMinor: 10_500, strategy: 'snowball', startDate })).toMatchObject({ feasible: true, monthsToDebtFree: 1, totalPaidMinor: 10_500 });
  });

  it('says so when payments never outrun the interest', () => {
    const debts = [{ id: 'x', balanceMinor: 1_000_000, aprBps: 2400, minimumPaymentMinor: 10_000 }];
    expect(calcDebtPayoff({ debts, monthlyBudgetMinor: 15_000, strategy: 'avalanche', startDate })).toEqual({
      strategy: 'avalanche', feasible: false, reason: 'not_paid_off_within_50_years', minimumBudgetMinor: 10_000,
    });
  });

  it('reports a runaway balance as unpayable instead of failing', () => {
    // Found by the property tests. Snowball aims at the smaller, interest-free debt first;
    // meanwhile the 45% debt has no minimum payment and grows faster than the budget can ever catch.
    const debts = [
      { id: 'costly', balanceMinor: 3_154_913, aprBps: 4532, minimumPaymentMinor: 0 },
      { id: 'free', balanceMinor: 3_151_747, aprBps: 0, minimumPaymentMinor: 0 },
    ];
    const result = compareDebtStrategies({ debts, monthlyBudgetMinor: 125_000, startDate });
    expect(result.snowball).toMatchObject({ feasible: false, reason: 'not_paid_off_within_50_years' });
    expect(result.avalanche).toMatchObject({ feasible: true });
    expect(result.difference).toBeNull();
  });

  it('truncates a long schedule but still reports full totals', () => {
    const debts = [{ id: 'x', balanceMinor: 100_000, aprBps: 0, minimumPaymentMinor: 1000 }];
    const result = plan(calcDebtPayoff({ debts, monthlyBudgetMinor: 1000, strategy: 'snowball', startDate, maxScheduleMonths: 12 }));
    expect(result).toMatchObject({ monthsToDebtFree: 100, totalPaidMinor: 100_000, scheduleTruncated: true });
    expect(result.schedule).toHaveLength(12);
    expect(plan(calcDebtPayoff({ debts, monthlyBudgetMinor: 1000, strategy: 'snowball', startDate })).scheduleTruncated).toBe(false);
  });

  it('rejects bad input', () => {
    const ok = { id: 'x', balanceMinor: 1, aprBps: 1, minimumPaymentMinor: 1 };
    const run = (over: object) => () => calcDebtPayoff({ debts: [ok], monthlyBudgetMinor: 10, strategy: 'snowball', startDate, ...over } as never);
    expect(run({ strategy: 'fastest' })).toThrow(/strategy/);
    expect(run({ debts: 'none' })).toThrow(CalcError);
    expect(run({ debts: Array(51).fill(ok) })).toThrow(CalcError);
    expect(run({ debts: [ok, ok] })).toThrow(/unique/);
    expect(run({ debts: [{ ...ok, id: '' }] })).toThrow(/unique/);
    expect(run({ debts: [{ ...ok, id: 7 }] })).toThrow(/unique/);
    expect(run({ debts: [{ ...ok, aprBps: 100_001 }] })).toThrow(/aprBps/);
    expect(run({ debts: [{ ...ok, balanceMinor: -1 }] })).toThrow(/balanceMinor/);
    expect(run({ monthlyBudgetMinor: 1.5 })).toThrow(/monthlyBudgetMinor/);
    expect(run({ startDate: 'soon' })).toThrow(/startDate/);
    expect(run({ maxScheduleMonths: 601 })).toThrow(/maxScheduleMonths/);
  });
});

describe('compareDebtStrategies', () => {
  it('reports what avalanche saves', () => {
    const debts: DebtInput[] = [
      { id: 'small-cheap', balanceMinor: 50_000, aprBps: 500, minimumPaymentMinor: 1000 },
      { id: 'big-costly', balanceMinor: 200_000, aprBps: 2400, minimumPaymentMinor: 4000 },
    ];
    const result = compareDebtStrategies({ debts, monthlyBudgetMinor: 20_000, startDate });
    expect(result.snowball.strategy).toBe('snowball');
    expect(result.avalanche.strategy).toBe('avalanche');
    expect(result.difference!.interestSavedByAvalancheMinor).toBe(plan(result.snowball).totalInterestMinor - plan(result.avalanche).totalInterestMinor);
    expect(result.difference!.interestSavedByAvalancheMinor).toBeGreaterThan(0);
    expect(result.difference!.monthsSavedByAvalanche).toBeGreaterThanOrEqual(0);
  });

  it('has no difference to report when the debt cannot be cleared', () => {
    expect(compareDebtStrategies({ debts: [{ id: 'x', balanceMinor: 100, aprBps: 0, minimumPaymentMinor: 50 }], monthlyBudgetMinor: 10, startDate }).difference).toBeNull();
  });
});

describe('debt payoff properties', () => {
  const debt = fc.record({
    balanceMinor: fc.integer({ min: 0, max: 5_000_000 }),
    aprBps: fc.integer({ min: 0, max: 6000 }),
    minimumPaymentMinor: fc.integer({ min: 0, max: 100_000 }),
  });
  const scenario = fc
    .record({ debts: fc.array(debt, { minLength: 1, maxLength: 6 }), extra: fc.integer({ min: 0, max: 500_000 }) })
    .map(({ debts, extra }) => {
      const withIds = debts.map((d, i) => ({ ...d, id: `d${i}` }));
      // Enough to cover every minimum plus interest, so most scenarios can be paid off.
      const floor = withIds.reduce((sum, d) => sum + d.minimumPaymentMinor + Math.ceil((d.balanceMinor * d.aprBps) / 120_000), 0);
      return { debts: withIds, monthlyBudgetMinor: floor + extra, startDate, maxScheduleMonths: 600 };
    });

  it('balances never go negative, payments never exceed the budget, and totals reconcile', () => {
    fc.assert(
      fc.property(scenario, fc.constantFrom('snowball' as const, 'avalanche' as const), (input, strategy) => {
        const r = calcDebtPayoff({ ...input, strategy });
        if (!r.feasible) return;
        const borrowed = input.debts.reduce((sum, d) => sum + d.balanceMinor, 0);
        expect(r.totalPaidMinor).toBe(borrowed + r.totalInterestMinor);
        expect(r.debts.reduce((sum, d) => sum + d.interestMinor, 0)).toBe(r.totalInterestMinor);
        expect(r.schedule).toHaveLength(r.monthsToDebtFree);
        let previous = Infinity;
        for (const row of r.schedule) {
          expect(row.remainingMinor).toBeGreaterThanOrEqual(0);
          expect(row.paymentMinor).toBeLessThanOrEqual(input.monthlyBudgetMinor);
          expect(row.paymentMinor).toBeGreaterThanOrEqual(0);
          previous = row.remainingMinor;
        }
        expect(r.schedule.length === 0 || previous === 0).toBe(true);
        expect(Math.max(0, ...r.debts.map((d) => d.paidOffInMonth))).toBe(r.monthsToDebtFree);
      }),
      { numRuns: 300 },
    );
  });

  it('avalanche never costs more interest than snowball, beyond per-month rounding', () => {
    fc.assert(
      fc.property(scenario, (input) => {
        const { snowball, avalanche } = compareDebtStrategies(input);
        if (!snowball.feasible || !avalanche.feasible) return;
        // Interest is rounded to a whole minor unit per debt per month, so allow that much slack.
        const slack = input.debts.length * Math.max(snowball.monthsToDebtFree, avalanche.monthsToDebtFree);
        expect(avalanche.totalInterestMinor).toBeLessThanOrEqual(snowball.totalInterestMinor + slack);
      }),
      { numRuns: 300 },
    );
  });

  it('gives the same answer every time', () => {
    fc.assert(
      fc.property(scenario, (input) => {
        expect(compareDebtStrategies(input)).toEqual(compareDebtStrategies(structuredClone(input)));
      }),
      { numRuns: 50 },
    );
  });
});
