import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { add, addMonths, CalcError, int, monthlyInterest, splitByPercent, toMonth } from '../src';

describe('int', () => {
  it('accepts whole numbers in range', () => {
    expect(int('x', 0)).toBe(0);
    expect(int('x', 5, 5)).toBe(5);
  });
  it('rejects everything else', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, '5', null, undefined, 1e13 + 1]) {
      expect(() => int('x', bad)).toThrow(CalcError);
    }
    expect(() => int('x', 6, 5)).toThrow(/between 0 and 5/);
  });
});

describe('monthlyInterest', () => {
  it('charges a twelfth of the annual rate, rounding half up', () => {
    expect(monthlyInterest(100_000, 1200)).toBe(1000);
    expect(monthlyInterest(1510, 1200)).toBe(15); // 15.1
    expect(monthlyInterest(50, 1200)).toBe(1); // exactly 0.5
    expect(monthlyInterest(49, 1200)).toBe(0); // 0.49
    expect(monthlyInterest(0, 5000)).toBe(0);
    expect(monthlyInterest(5000, 0)).toBe(0);
  });
  it('stays exact where ordinary multiplication would not', () => {
    expect(monthlyInterest(9_999_999_999_999, 99_999)).toBe(8_333_249_999_999);
  });
});

describe('add', () => {
  it('adds, and refuses inexact results', () => {
    expect(add(2, 3)).toBe(5);
    expect(() => add(Number.MAX_SAFE_INTEGER, 1)).toThrow(CalcError);
  });
});

describe('months', () => {
  it('normalises dates to a month', () => {
    expect(toMonth('2026-11')).toBe('2026-11');
    expect(toMonth('2026-11-10')).toBe('2026-11');
    for (const bad of ['2026', '2026-13', '2026-00', '11/2026', '']) expect(() => toMonth(bad)).toThrow(CalcError);
  });
  it('adds months across year ends', () => {
    expect(addMonths('2026-11', 0)).toBe('2026-11');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-12', 12)).toBe('2027-12');
    expect(addMonths('2026-01', 599)).toBe('2075-12');
  });
});

describe('splitByPercent', () => {
  it('splits exactly', () => {
    expect(splitByPercent(1000, [50, 30, 20])).toEqual([500, 300, 200]);
    expect(splitByPercent(101, [50, 30, 20])).toEqual([51, 30, 20]);
    expect(splitByPercent(1, [34, 33, 33])).toEqual([1, 0, 0]);
    expect(splitByPercent(0, [50, 30, 20])).toEqual([0, 0, 0]);
  });
  it('always adds back to the total', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e13 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (total, a, b) => {
        fc.pre(a + b <= 100);
        const parts = splitByPercent(total, [a, b, 100 - a - b]);
        expect(parts.reduce((x, y) => x + y, 0)).toBe(total);
        expect(parts.every((p) => p >= 0)).toBe(true);
      }),
    );
  });
});
