import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calcEmergencyFund, calcSavingsProjection, CalcError } from '../src';

const startDate = '2026-11';

describe('calcEmergencyFund', () => {
  it('works out the target, the gap and how long it takes', () => {
    expect(calcEmergencyFund({ essentialMonthlyMinor: 60_000, targetMonths: 3, currentBalanceMinor: 45_000, monthlyContributionMinor: 20_000, startDate })).toEqual({
      targetMinor: 180_000,
      gapMinor: 135_000,
      monthsCovered: 0.7,
      monthsToTarget: 7, // 135,000 / 20,000 = 6.75, so the seventh contribution gets there
      targetReachedMonth: '2027-05',
    });
  });

  it('reports a target already met', () => {
    expect(calcEmergencyFund({ essentialMonthlyMinor: 60_000, targetMonths: 3, currentBalanceMinor: 200_000, monthlyContributionMinor: 0, startDate })).toEqual({
      targetMinor: 180_000, gapMinor: 0, monthsCovered: 3.3, monthsToTarget: 0, targetReachedMonth: null,
    });
  });

  it('reports a target that is never reached without contributions', () => {
    expect(calcEmergencyFund({ essentialMonthlyMinor: 60_000, targetMonths: 3, currentBalanceMinor: 0, monthlyContributionMinor: 0, startDate })).toMatchObject({ monthsToTarget: null, targetReachedMonth: null, monthsCovered: 0 });
  });

  it('handles zero essentials', () => {
    expect(calcEmergencyFund({ essentialMonthlyMinor: 0, targetMonths: 6, currentBalanceMinor: 500, monthlyContributionMinor: 10, startDate })).toMatchObject({ targetMinor: 0, gapMinor: 0, monthsCovered: null, monthsToTarget: 0 });
  });

  it('rejects bad input', () => {
    const ok = { essentialMonthlyMinor: 1, targetMonths: 3, currentBalanceMinor: 0, monthlyContributionMinor: 1, startDate };
    expect(() => calcEmergencyFund({ ...ok, targetMonths: 61 })).toThrow(/targetMonths/);
    expect(() => calcEmergencyFund({ ...ok, currentBalanceMinor: -5 })).toThrow(CalcError);
    expect(() => calcEmergencyFund({ ...ok, startDate: 'x' })).toThrow(CalcError);
  });

  it('reaches the target in exactly the stated number of contributions', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e8 }), fc.integer({ min: 0, max: 24 }), fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 1, max: 1e8 }), (essentialMonthlyMinor, targetMonths, currentBalanceMinor, monthlyContributionMinor) => {
        const r = calcEmergencyFund({ essentialMonthlyMinor, targetMonths, currentBalanceMinor, monthlyContributionMinor, startDate });
        const n = r.monthsToTarget!;
        expect(currentBalanceMinor + n * monthlyContributionMinor).toBeGreaterThanOrEqual(r.targetMinor);
        if (n > 0) expect(currentBalanceMinor + (n - 1) * monthlyContributionMinor).toBeLessThan(r.targetMinor);
      }),
    );
  });
});

describe('calcSavingsProjection', () => {
  it('matches a hand-worked example', () => {
    // 1,000.00 at 12% a year (1% a month), adding 100.00 at the end of each month:
    //   month 1: 1,000.00 + 10.00 + 100.00 = 1,110.00
    //   month 2: 1,110.00 + 11.10 + 100.00 = 1,221.10
    //   month 3: 1,221.10 + 12.21 + 100.00 = 1,333.31
    expect(calcSavingsProjection({ startingBalanceMinor: 100_000, monthlyContributionMinor: 10_000, annualRateBps: 1200, months: 3, targetMinor: 120_000, startDate })).toEqual({
      finalBalanceMinor: 133_331,
      totalContributedMinor: 30_000,
      totalGrowthMinor: 3331,
      monthsToTarget: 2,
      targetReachedMonth: '2026-12',
      series: [{ month: 3, date: '2027-01', balanceMinor: 133_331, contributedMinor: 30_000, growthMinor: 3331 }],
    });
  });

  it('returns a point per year plus the final month', () => {
    const r = calcSavingsProjection({ startingBalanceMinor: 0, monthlyContributionMinor: 1000, annualRateBps: 0, months: 30, startDate });
    expect(r.series.map((p) => [p.month, p.date, p.balanceMinor])).toEqual([[12, '2027-10', 12_000], [24, '2028-10', 24_000], [30, '2029-04', 30_000]]);
    expect(r).toMatchObject({ monthsToTarget: null, targetReachedMonth: null, totalGrowthMinor: 0 });
  });

  it('handles a target already met, one never met, and a zero-length projection', () => {
    const base = { startingBalanceMinor: 500, monthlyContributionMinor: 10, annualRateBps: 0, months: 5, startDate };
    expect(calcSavingsProjection({ ...base, targetMinor: 500 })).toMatchObject({ monthsToTarget: 0, targetReachedMonth: null });
    expect(calcSavingsProjection({ ...base, targetMinor: 1_000_000 })).toMatchObject({ monthsToTarget: null });
    expect(calcSavingsProjection({ ...base, months: 0 })).toEqual({ finalBalanceMinor: 500, totalContributedMinor: 0, totalGrowthMinor: 0, monthsToTarget: null, targetReachedMonth: null, series: [] });
  });

  it('refuses results too large to be exact, and bad input', () => {
    const base = { startingBalanceMinor: 1e13, monthlyContributionMinor: 0, annualRateBps: 100_000, months: 600, startDate };
    expect(() => calcSavingsProjection(base)).toThrow(/too large/);
    expect(() => calcSavingsProjection({ ...base, months: 601 })).toThrow(/months/);
    expect(() => calcSavingsProjection({ ...base, annualRateBps: 100_001 })).toThrow(/annualRateBps/);
    expect(() => calcSavingsProjection({ ...base, targetMinor: -1 })).toThrow(/targetMinor/);
  });

  it('always reconciles and never shrinks', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 0, max: 1e7 }), fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 0, max: 600 }), (startingBalanceMinor, monthlyContributionMinor, annualRateBps, months) => {
        const r = calcSavingsProjection({ startingBalanceMinor, monthlyContributionMinor, annualRateBps, months, startDate });
        expect(r.finalBalanceMinor).toBe(startingBalanceMinor + r.totalContributedMinor + r.totalGrowthMinor);
        let previous = startingBalanceMinor;
        for (const point of r.series) {
          expect(point.balanceMinor).toBeGreaterThanOrEqual(previous);
          previous = point.balanceMinor;
        }
        if (months > 0) expect(r.series.at(-1)!.balanceMinor).toBe(r.finalBalanceMinor);
      }),
    );
  });
});
