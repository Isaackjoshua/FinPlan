import type { Item } from '../src';

/**
 * The profile that first showed variable income does not fit a single figure. Amounts are in
 * whole shillings here and become minor units below (TZS has two decimals).
 */
export const tzs = (shillings: number) => shillings * 100;

const expense = (
  label: string,
  shillings: number,
  category: Extract<Item, { kind: 'expense' }>['category'],
  essential: boolean,
  frequency: 'monthly' | 'quarterly' = 'monthly',
): Item => ({ id: label, kind: 'expense', label, amountMinor: tzs(shillings), frequency, category, essential });

export const income: Item = { id: 'income', kind: 'income', label: 'Work', amountMinor: tzs(200_000), frequency: 'monthly' };
export const rent = expense('rent', 255_000, 'housing', true, 'quarterly');
export const food = expense('food', 160_000, 'food', true);
export const claude = expense('claude', 66_000, 'personal', false);
export const data = expense('data', 17_500, 'utilities', false);
export const otherExpenses = [
  expense('gym', 60_000, 'personal', false),
  expense('transport', 55_000, 'transport', true),
  expense('electricity', 20_000, 'utilities', true),
  expense('water', 10_000, 'utilities', true),
];
export const savings: Item = { id: 'savings', kind: 'savings', label: 'Buffer', balanceMinor: tzs(300_000), apyBps: 0, isEmergencyFund: true };
export const debt: Item = { id: 'debt', kind: 'debt', label: 'Friend', debtKind: 'informal', balanceMinor: tzs(30_000), aprBps: 0, minimumPaymentMinor: 0 };

/** Everything: 473,500 a month going out against 200,000 coming in. */
export const groundingItems: Item[] = [income, rent, food, claude, data, ...otherExpenses, savings, debt];
/** As it stood when it misled people: no housing, no food, no transport. */
export const incompleteItems: Item[] = [income, claude, data, savings, debt];
