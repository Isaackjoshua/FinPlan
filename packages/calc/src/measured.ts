import type { Band } from './scenarios';
import { CalcError, int, MAX_TOTAL } from './util';

/** Fewer observed months than this say nothing reliable; from the second figure on they can be relied on. */
export const PROVISIONAL_MONTHS = 3;
export const MEASURED_MONTHS = 6;

export interface MeasuredIncome extends Band {
  monthsObserved: number;
  typicalMinor: number;
  goodMinor: number;
}

/**
 * What observed months say about income: the lowest is a lean month, the median a typical one
 * (the lower whole unit when it falls between two), the upper quartile a good one. Null without any months.
 */
export function measureIncome(monthlyTotalsMinor: number[]): MeasuredIncome | null {
  const sorted = monthlyTotalsMinor.map((total, i) => int(`monthlyTotalsMinor[${i}]`, total, MAX_TOTAL)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return null;
  return {
    monthsObserved: n,
    leanMinor: sorted[0]!,
    typicalMinor: Number((BigInt(sorted[Math.floor((n - 1) / 2)]!) + BigInt(sorted[Math.floor(n / 2)]!)) / 2n),
    goodMinor: sorted[Math.ceil(n * 0.75) - 1]!,
  };
}

/**
 * The deepest hole that a run of months dug: how far income fell behind outgoings, added up
 * until it had caught up again. Each inner list is an unbroken run of months, oldest first;
 * a month that was not observed ends a run, because nothing is known about it.
 */
export function worstShortfall(runsMinor: number[][], outgoingsMinor: number): number {
  const outgoings = int('outgoingsMinor', outgoingsMinor, MAX_TOTAL);
  let worst = 0;
  for (const run of runsMinor) {
    let behind = 0;
    for (const income of run) {
      behind = Math.max(0, behind + (outgoings - int('runsMinor', income, MAX_TOTAL)));
      if (!Number.isSafeInteger(behind)) throw new CalcError('out_of_range', 'The result is too large to calculate exactly');
      worst = Math.max(worst, behind);
    }
  }
  return worst;
}

export interface LeanRunInput {
  leanIncomeMinor: number;
  outgoingsMinor: number;
  /** How many lean months in a row to be ready for. */
  months: number;
}

/** What it takes to get through a number of lean months in a row. */
export function leanRunShortfall(input: LeanRunInput): number {
  const gap = Math.max(0, int('outgoingsMinor', input.outgoingsMinor, MAX_TOTAL) - int('leanIncomeMinor', input.leanIncomeMinor, MAX_TOTAL));
  const total = gap * int('months', input.months, 60);
  if (!Number.isSafeInteger(total)) throw new CalcError('out_of_range', 'The result is too large to calculate exactly');
  return total;
}
