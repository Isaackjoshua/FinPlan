import { daysInMonth, measureIncome, monthsBetween, type MeasuredIncome } from '@fin/calc';
import type { CheckIn } from './checkins';

/** Why a month's check-ins do not add up to a month that can be measured. */
export type ExcludedReason = 'gap' | 'overlap' | 'crosses_month_end' | 'income_not_stated';

export interface IncomeHistory {
  /** Months whose income is known for certain, oldest first; the latest twelve. */
  observed: { month: string; totalMinor: number }[];
  /** Finished months with check-ins that could not be counted. */
  excluded: { month: string; reason: ExcludedReason }[];
  measured: MeasuredIncome | null;
  /** The observed totals split into unbroken runs of months, oldest first. */
  runs: number[][];
}

const MONTHS_KEPT = 12;

/**
 * Works out which months' income is known from check-ins. A month counts when check-ins cover
 * each of its days exactly once, and says nothing otherwise: part of a month would look like a
 * lean one. The month `today` falls in is not over, so it never counts.
 */
export function incomeHistory(checkIns: Pick<CheckIn, 'periodStart' | 'periodEnd' | 'actuals'>[], today: string): IncomeHistory {
  const months = new Map<string, { days: Set<number>; total: number; problem: ExcludedReason | null }>();
  const spans: { first: string; last: string }[] = [];
  const at = (month: string) => {
    if (!months.has(month)) months.set(month, { days: new Set(), total: 0, problem: null });
    return months.get(month)!;
  };

  for (const { periodStart, periodEnd, actuals } of checkIns) {
    const month = periodStart.slice(0, 7);
    if (periodEnd.slice(0, 7) !== month) {
      // How it divides between the months is not known, so all of them are in doubt.
      at(month);
      at(periodEnd.slice(0, 7));
      spans.push({ first: month, last: periodEnd.slice(0, 7) });
      continue;
    }
    const entry = at(month);
    entry.total += actuals.incomeMinor;
    if (actuals.incomeMinor === 0 && !actuals.noIncome) entry.problem ??= 'income_not_stated';
    for (let day = Number(periodStart.slice(8)); day <= Number(periodEnd.slice(8)); day++) {
      if (entry.days.has(day)) entry.problem ??= 'overlap';
      entry.days.add(day);
    }
  }

  const finished = [...months].filter(([month]) => month < today.slice(0, 7)).sort(([a], [b]) => (a < b ? -1 : 1));
  const reason = (month: string, entry: { days: Set<number>; problem: ExcludedReason | null }): ExcludedReason | null =>
    spans.some(({ first, last }) => month >= first && month <= last) ? 'crosses_month_end' : (entry.problem ?? (entry.days.size < daysInMonth(month) ? 'gap' : null));
  const observed = finished
    .filter(([month, entry]) => reason(month, entry) === null)
    .map(([month, { total }]) => ({ month, totalMinor: total }))
    .slice(-MONTHS_KEPT);

  const runs: number[][] = [];
  for (const [i, { month, totalMinor }] of observed.entries()) {
    if (i > 0 && monthsBetween(observed[i - 1]!.month, month) === 1) runs.at(-1)!.push(totalMinor);
    else runs.push([totalMinor]);
  }
  return {
    observed,
    excluded: finished.flatMap(([month, entry]) => {
      const why = reason(month, entry);
      return why ? [{ month, reason: why }] : [];
    }),
    measured: measureIncome(observed.map((m) => m.totalMinor)),
    runs,
  };
}
