import { calcScenarios, MEASURED_MONTHS, PROVISIONAL_MONTHS, type Band, type ScenariosResult } from '@fin/calc';
import type { IncomeHistory } from './history';
import { toMonthly } from './money';
import type { Item } from './profile';
import type { Summary } from './summary';

export type { Scenario, ScenariosResult } from '@fin/calc';

/**
 * Where income figures come from. `declared`: what the user said they expect. `provisional`:
 * the same, with gaps filled from a few observed months. `measured`: observed months alone.
 */
export const INCOME_BASES = ['declared', 'provisional', 'measured'] as const;
export type IncomeBasis = (typeof INCOME_BASES)[number];

/** The figures to plan on, with where they come from. */
export interface IncomeBand extends Band {
  /** True when any recorded income changes from month to month. */
  varies: boolean;
  basis: IncomeBasis;
  monthsObserved: number;
  /** What the profile says, whatever was observed. */
  declared: Band;
  /** An observed month brought in less than the profile says is the least to count on. */
  belowDeclared: boolean;
}

/**
 * Adds up what the profile says about income in a lean, a typical and a good month. Fixed income
 * counts the same in each. If any source has no figure for a kind of month, the total for it is
 * unknown. Adding up lean figures assumes every source is lean at once, the cautious reading.
 */
function declaredBand(items: Item[]): Band {
  const band: Band = { leanMinor: 0, typicalMinor: 0, goodMinor: 0 };
  const plus = (total: number | null, amount: number | null) => (total === null || amount === null ? null : total + amount);
  for (const item of items) {
    if (item.kind !== 'income') continue;
    const base = toMonthly(item.amountMinor, item.frequency);
    const variable = item.variability === 'variable';
    band.leanMinor += base;
    band.typicalMinor = plus(band.typicalMinor, variable ? (item.typicalMinor ?? null) : base);
    band.goodMinor = plus(band.goodMinor, variable ? (item.highMinor ?? null) : base);
  }
  return band;
}

/**
 * Monthly income to plan on. With enough observed months, what was measured takes over from what
 * was declared. A worse month than declared counts straight away: the profile is never changed
 * by it, but a plan should not rest on a figure that has already failed.
 */
export function incomeBand(items: Item[], history?: IncomeHistory): IncomeBand {
  const declared = declaredBand(items);
  const varies = items.some((item) => item.kind === 'income' && item.variability === 'variable');
  const measured = varies ? (history?.measured ?? null) : null;
  const monthsObserved = history?.measured?.monthsObserved ?? 0;
  const common = { varies, monthsObserved, declared, belowDeclared: measured !== null && measured.leanMinor < declared.leanMinor };
  if (!measured) return { ...common, basis: 'declared', ...declared };
  if (monthsObserved >= MEASURED_MONTHS) {
    const { leanMinor, typicalMinor, goodMinor } = measured;
    return { ...common, basis: 'measured', leanMinor, typicalMinor, goodMinor };
  }

  const provisional = monthsObserved >= PROVISIONAL_MONTHS;
  const leanMinor = Math.min(declared.leanMinor, measured.leanMinor);
  // A measured figure fills a gap only as far as the declared ones around it allow.
  const ceiling = declared.goodMinor ?? Infinity;
  const typicalMinor = declared.typicalMinor ?? (provisional ? Math.min(Math.max(measured.typicalMinor, leanMinor), ceiling) : null);
  const goodMinor = declared.goodMinor ?? (provisional ? Math.max(measured.goodMinor, typicalMinor ?? leanMinor) : null);
  return { ...common, basis: provisional ? 'provisional' : 'declared', leanMinor, typicalMinor, goodMinor };
}

/** What each kind of month works out to on the spending recorded; null when income does not vary. */
export function profileScenarios(band: IncomeBand, summary: Summary): ScenariosResult | null {
  if (!band.varies) return null;
  return calcScenarios({
    income: band,
    outgoingsMinor: summary.monthlyExpenses + summary.monthlyDebtMinimums,
    essentialOutgoingsMinor: summary.monthlyEssentialExpenses + summary.monthlyDebtMinimums,
    goalContributionsMinor: 0,
    bufferMinor: summary.emergencyFund,
  });
}

/** The totals with a lean month's income, when income varies. */
export function withLeanIncome(summary: Summary, band: IncomeBand): Summary {
  if (!band.varies) return summary;
  return { ...summary, monthlyIncome: band.leanMinor, monthlySurplus: band.leanMinor - summary.monthlyExpenses - summary.monthlyDebtMinimums };
}

/** What each kind of month leaves over before any goal; null for a kind that is not known. */
export function leftOver(summary: Summary, scenarios: ScenariosResult | null): { leanMinor: number; typicalMinor: number | null; goodMinor: number | null } {
  if (!scenarios) return { leanMinor: summary.monthlySurplus, typicalMinor: summary.monthlySurplus, goodMinor: summary.monthlySurplus };
  const [lean, typical, good] = scenarios.scenarios;
  return { leanMinor: lean!.balanceMinor!, typicalMinor: typical!.balanceMinor, goodMinor: good!.balanceMinor };
}
