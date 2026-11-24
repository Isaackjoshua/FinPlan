import { calcSinkingFund, type SinkingFundResult } from '@fin/calc';
import { lumpyMonths, toMonthly, type Frequency } from './money';
import type { Item } from './profile';
import type { ExpenseTier } from './schemas';

export type Expense = Extract<Item, { kind: 'expense' }>;
export const expensesOf = (items: Item[]) => items.filter((item) => item.kind === 'expense') as Expense[];

/** The tier an expense counts as. Until it has been given one, being essential decides. */
export const tierOf = (expense: Pick<Expense, 'tier' | 'essential'>): ExpenseTier => expense.tier ?? (expense.essential ? 'survival' : 'discretionary');

export interface ExpenseTiers {
  /** What an emergency fund is sized on. */
  survivalMinor: number;
  /** Owed or awkward to stop, and not covered by an emergency fund. */
  committedMinor: number;
  discretionaryMinor: number;
  /** True once any expense has been given a tier. */
  classified: boolean;
}

/** Monthly spending by tier. The three add up to all of it. */
export function expenseTiers(items: Item[]): ExpenseTiers {
  const totals: ExpenseTiers = { survivalMinor: 0, committedMinor: 0, discretionaryMinor: 0, classified: false };
  for (const expense of expensesOf(items)) {
    totals[`${tierOf(expense)}Minor`] += toMonthly(expense.amountMinor, expense.frequency);
    totals.classified ||= expense.tier !== undefined;
  }
  return totals;
}

/** A bill that comes less often than monthly, and what to set aside for it. */
export interface Obligation extends SinkingFundResult {
  id: string;
  label: string;
  amountMinor: number;
  frequency: Frequency;
  /** What is still to be set aside this month, after what already has been. */
  setAsideMinor: number;
}

export interface Obligations {
  items: Obligation[];
  /** What is still to be set aside this month in all: the catch-up figure where a due date is known, the steady one where not. */
  setAsideMinor: number;
  steadyMonthlyMinor: number;
  /** How much of the monthly spending total is these bills spread out evenly. */
  smoothedMonthlyMinor: number;
}

export const setAside = (o: Pick<SinkingFundResult, 'catchUpMonthlyMinor' | 'steadyMonthlyMinor'>) => o.catchUpMonthlyMinor ?? o.steadyMonthlyMinor;

/** What has been set aside this month, by expense. */
export type GivenThisMonth = ReadonlyMap<string, number>;

/**
 * The bills a monthly total hides by spreading them out, soonest first. The monthly figures are
 * those the month began with, so that setting money aside does not change how much to.
 */
export function obligations(items: Item[], today: string, given: GivenThisMonth = new Map()): Obligations {
  const lumpy = expensesOf(items)
    .filter((expense) => expense.amountMinor > 0 && lumpyMonths(expense.frequency) !== null)
    .map((e): Obligation => {
      const already = given.get(e.id) ?? 0;
      const fund = (reservedMinor: number) => calcSinkingFund({ amountMinor: e.amountMinor, everyMonths: lumpyMonths(e.frequency)!, reservedMinor, nextDueDate: e.nextDueDate, today });
      const now = fund(e.reservedMinor ?? 0);
      const { catchUpMonthlyMinor } = fund(Math.max(0, (e.reservedMinor ?? 0) - already));
      const monthly = { ...now, catchUpMonthlyMinor };
      return { id: e.id, label: e.label, amountMinor: e.amountMinor, frequency: e.frequency, ...monthly, setAsideMinor: Math.max(0, setAside(monthly) - already) };
    })
    .sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
  const sum = (pick: (o: Obligation) => number) => lumpy.reduce((total, o) => total + pick(o), 0);
  return {
    items: lumpy,
    setAsideMinor: sum((o) => o.setAsideMinor),
    steadyMonthlyMinor: sum((o) => o.steadyMonthlyMinor),
    smoothedMonthlyMinor: sum((o) => toMonthly(o.amountMinor, o.frequency)),
  };
}
