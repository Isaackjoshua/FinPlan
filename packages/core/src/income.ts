import { calcScenarios, type Band, type ScenariosResult } from '@fin/calc';
import { toMonthly } from './money';
import type { Item } from './profile';
import type { Summary } from './summary';

export type { Scenario, ScenariosResult } from '@fin/calc';

export interface IncomeBand extends Band {
  /** True when any recorded income changes from month to month. */
  varies: boolean;
  /** Where the figures come from: what the user said they expect. */
  basis: 'declared';
}

/**
 * Monthly income in a lean, a typical and a good month. Fixed income counts the same in each.
 * If any source has no figure for a kind of month, the total for it is unknown. Adding up the
 * lean figures assumes every source is lean at once, which is the cautious reading.
 */
export function incomeBand(items: Item[]): IncomeBand {
  const band: IncomeBand = { varies: false, basis: 'declared', leanMinor: 0, typicalMinor: 0, goodMinor: 0 };
  const plus = (total: number | null, amount: number | null) => (total === null || amount === null ? null : total + amount);
  for (const item of items) {
    if (item.kind !== 'income') continue;
    const base = toMonthly(item.amountMinor, item.frequency);
    const variable = item.variability === 'variable';
    band.varies ||= variable;
    band.leanMinor += base;
    band.typicalMinor = plus(band.typicalMinor, variable ? (item.typicalMinor ?? null) : base);
    band.goodMinor = plus(band.goodMinor, variable ? (item.highMinor ?? null) : base);
  }
  return band;
}

/** What each kind of month works out to on the spending recorded; null when income does not vary. */
export function profileScenarios(items: Item[], summary: Summary): ScenariosResult | null {
  const band = incomeBand(items);
  if (!band.varies) return null;
  return calcScenarios({
    income: band,
    outgoingsMinor: summary.monthlyExpenses + summary.monthlyDebtMinimums,
    essentialOutgoingsMinor: summary.monthlyEssentialExpenses + summary.monthlyDebtMinimums,
    goalContributionsMinor: 0,
    bufferMinor: summary.emergencyFund,
  });
}
