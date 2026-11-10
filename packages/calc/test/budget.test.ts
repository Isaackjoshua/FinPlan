import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calcBudget, CalcError } from '../src';

const expenses = [
  { category: 'housing', amountMinor: 150_000, essential: true },
  { category: 'food', amountMinor: 60_000, essential: true },
  { category: 'food', amountMinor: 20_000, essential: false },
  { category: 'entertainment', amountMinor: 30_000, essential: false },
];

describe('calcBudget', () => {
  it('compares spending with the 50/30/20 rule', () => {
    expect(calcBudget({ netIncomeMinor: 400_000, expenses, method: '50_30_20' })).toEqual({
      netIncomeMinor: 400_000,
      totalExpensesMinor: 260_000,
      surplusMinor: 140_000,
      shortfallMinor: 0,
      savingsRateBps: 3500,
      buckets: [
        { bucket: 'needs', targetMinor: 200_000, actualMinor: 210_000, differenceMinor: 10_000 },
        { bucket: 'wants', targetMinor: 120_000, actualMinor: 50_000, differenceMinor: -70_000 },
        { bucket: 'savings', targetMinor: 80_000, actualMinor: 140_000, differenceMinor: 60_000 },
      ],
      byCategory: [
        { category: 'housing', amountMinor: 150_000, shareOfIncomeBps: 3750 },
        { category: 'food', amountMinor: 80_000, shareOfIncomeBps: 2000 },
        { category: 'entertainment', amountMinor: 30_000, shareOfIncomeBps: 750 },
      ],
    });
  });

  it('accepts a custom split', () => {
    const result = calcBudget({ netIncomeMinor: 400_000, expenses, method: { needsPercent: 60, wantsPercent: 10, savingsPercent: 30 } });
    expect(result.buckets.map((b) => b.targetMinor)).toEqual([240_000, 40_000, 120_000]);
  });

  it('rejects a split that does not add to 100, or an unknown method', () => {
    expect(() => calcBudget({ netIncomeMinor: 1, expenses: [], method: { needsPercent: 60, wantsPercent: 30, savingsPercent: 30 } })).toThrow(/add up to 100/);
    expect(() => calcBudget({ netIncomeMinor: 1, expenses: [], method: 'envelope' as never })).toThrow(CalcError);
    expect(() => calcBudget({ netIncomeMinor: 1, expenses: [], method: undefined as never })).toThrow(CalcError);
  });

  it('assigns every unit under zero-based budgeting', () => {
    const result = calcBudget({ netIncomeMinor: 400_000, expenses, method: 'zero_based' });
    expect(result.buckets.map((b) => [b.targetMinor, b.differenceMinor])).toEqual([[210_000, 0], [50_000, 0], [140_000, 0]]);
  });

  it('reports a shortfall when spending exceeds income', () => {
    const result = calcBudget({ netIncomeMinor: 200_000, expenses, method: '50_30_20' });
    expect(result).toMatchObject({ surplusMinor: 0, shortfallMinor: 60_000, savingsRateBps: 0 });
    expect(result.buckets[2]).toEqual({ bucket: 'savings', targetMinor: 40_000, actualMinor: 0, differenceMinor: -40_000 });
  });

  it('handles no income and no expenses', () => {
    expect(calcBudget({ netIncomeMinor: 0, expenses, method: '50_30_20' })).toMatchObject({ savingsRateBps: 0, shortfallMinor: 260_000 });
    expect(calcBudget({ netIncomeMinor: 0, expenses, method: '50_30_20' }).byCategory[0]!.shareOfIncomeBps).toBe(0);
    expect(calcBudget({ netIncomeMinor: 100, expenses: [], method: 'zero_based' })).toMatchObject({ surplusMinor: 100, byCategory: [] });
  });

  it('orders equal categories by name', () => {
    const result = calcBudget({ netIncomeMinor: 10, expenses: [{ category: 'b', amountMinor: 1, essential: true }, { category: 'a', amountMinor: 1, essential: true }], method: 'zero_based' });
    expect(result.byCategory.map((c) => c.category)).toEqual(['a', 'b']);
  });

  it('rejects bad input', () => {
    expect(() => calcBudget({ netIncomeMinor: -1, expenses: [], method: '50_30_20' })).toThrow(CalcError);
    expect(() => calcBudget({ netIncomeMinor: 1, expenses: 'none' as never, method: '50_30_20' })).toThrow(CalcError);
    expect(() => calcBudget({ netIncomeMinor: 1, expenses: Array(201).fill(expenses[0]), method: '50_30_20' })).toThrow(CalcError);
    expect(() => calcBudget({ netIncomeMinor: 1, expenses: [{ category: 'x', amountMinor: 1.5, essential: true }], method: '50_30_20' })).toThrow(/expenses\[0\]/);
  });

  it('always reconciles', () => {
    const expense = fc.record({ category: fc.constantFrom('a', 'b', 'c'), amountMinor: fc.integer({ min: 0, max: 1e9 }), essential: fc.boolean() });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e10 }), fc.array(expense, { maxLength: 20 }), fc.constantFrom('50_30_20' as const, 'zero_based' as const), (netIncomeMinor, list, method) => {
        const r = calcBudget({ netIncomeMinor, expenses: list, method });
        const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
        // Income is fully accounted for: what was spent, plus what is left, minus any overspend.
        expect(r.totalExpensesMinor + r.surplusMinor - r.shortfallMinor).toBe(netIncomeMinor);
        expect(sum(r.byCategory.map((c) => c.amountMinor))).toBe(r.totalExpensesMinor);
        expect(r.buckets[0]!.actualMinor + r.buckets[1]!.actualMinor).toBe(r.totalExpensesMinor);
        if (method === '50_30_20') expect(sum(r.buckets.map((b) => b.targetMinor))).toBe(netIncomeMinor);
        expect(r.surplusMinor === 0 || r.shortfallMinor === 0).toBe(true);
      }),
    );
  });
});
