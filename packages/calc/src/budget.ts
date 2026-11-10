import { CalcError, int, splitByPercent } from './util';

export type BudgetMethod =
  | '50_30_20'
  | 'zero_based'
  | { needsPercent: number; wantsPercent: number; savingsPercent: number };

export interface BudgetInput {
  /** Monthly take-home income. */
  netIncomeMinor: number;
  /** Monthly expenses. "Essential" ones count as needs, the rest as wants. */
  expenses: { category: string; amountMinor: number; essential: boolean }[];
  method: BudgetMethod;
}

export interface BudgetResult {
  netIncomeMinor: number;
  totalExpensesMinor: number;
  /** Income left after expenses; 0 when there is a shortfall. */
  surplusMinor: number;
  /** How far expenses exceed income; 0 when there is a surplus. */
  shortfallMinor: number;
  /** Surplus as a share of income, in basis points. */
  savingsRateBps: number;
  /** Target against actual for each bucket. A positive difference means over target. */
  buckets: { bucket: 'needs' | 'wants' | 'savings'; targetMinor: number; actualMinor: number; differenceMinor: number }[];
  /** Spending per category, largest first, with its share of income in basis points. */
  byCategory: { category: string; amountMinor: number; shareOfIncomeBps: number }[];
}

function percents(method: BudgetMethod): [number, number, number] | null {
  if (method === '50_30_20') return [50, 30, 20];
  if (method === 'zero_based') return null;
  const parts: [number, number, number] = [
    int('needsPercent', method?.needsPercent, 100),
    int('wantsPercent', method?.wantsPercent, 100),
    int('savingsPercent', method?.savingsPercent, 100),
  ];
  if (parts[0] + parts[1] + parts[2] !== 100) throw new CalcError('invalid_input', 'The three percentages must add up to 100');
  return parts;
}

/**
 * Compares monthly spending with a budgeting rule.
 *  - 50_30_20: half of income to needs, 30% to wants, 20% to savings.
 *  - custom percentages: the same idea with your own split.
 *  - zero_based: every unit of income is given a job, so the targets are what is
 *    actually planned and whatever is left is assigned to savings.
 */
export function calcBudget(input: BudgetInput): BudgetResult {
  const income = int('netIncomeMinor', input.netIncomeMinor);
  if (!Array.isArray(input.expenses) || input.expenses.length > 200) {
    throw new CalcError('invalid_input', 'expenses must be a list of at most 200 items');
  }
  const split = percents(input.method);

  let needs = 0;
  let wants = 0;
  const categories = new Map<string, number>();
  for (const [i, expense] of input.expenses.entries()) {
    const amount = int(`expenses[${i}].amountMinor`, expense.amountMinor);
    if (expense.essential) needs += amount;
    else wants += amount;
    categories.set(expense.category, (categories.get(expense.category) ?? 0) + amount);
  }

  const total = needs + wants;
  const surplus = Math.max(0, income - total);
  const targets = split ? splitByPercent(income, split) : [needs, wants, surplus];
  const share = (amount: number) => (income === 0 ? 0 : Math.round((amount * 10_000) / income));
  const bucket = (name: 'needs' | 'wants' | 'savings', target: number, actual: number) => ({
    bucket: name,
    targetMinor: target,
    actualMinor: actual,
    differenceMinor: actual - target,
  });

  return {
    netIncomeMinor: income,
    totalExpensesMinor: total,
    surplusMinor: surplus,
    shortfallMinor: Math.max(0, total - income),
    savingsRateBps: share(surplus),
    buckets: [bucket('needs', targets[0]!, needs), bucket('wants', targets[1]!, wants), bucket('savings', targets[2]!, surplus)],
    byCategory: [...categories]
      .map(([category, amountMinor]) => ({ category, amountMinor, shareOfIncomeBps: share(amountMinor) }))
      .sort((a, b) => b.amountMinor - a.amountMinor || a.category.localeCompare(b.category)),
  };
}
