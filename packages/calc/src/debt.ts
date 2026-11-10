import { addMonths, CalcError, int, MAX_AMOUNT, MAX_MONTHS, MAX_RATE_BPS, monthlyInterest, toMonth } from './util';

export interface DebtInput {
  id: string;
  balanceMinor: number;
  aprBps: number;
  minimumPaymentMinor: number;
}

export type DebtStrategy = 'snowball' | 'avalanche';

export interface DebtPayoffInput {
  debts: DebtInput[];
  /** Total available for debt each month, minimum payments included. */
  monthlyBudgetMinor: number;
  /** First month of payments, "YYYY-MM" or "YYYY-MM-DD". Month 1 is this month. */
  startDate: string;
  /** How many months of schedule to return (default 120). The totals always cover the full payoff. */
  maxScheduleMonths?: number;
}

export interface DebtPayoffPlan {
  strategy: DebtStrategy;
  feasible: true;
  /** Debt ids in the order extra money is aimed at them. */
  priorityOrder: string[];
  monthsToDebtFree: number;
  /** Month of the final payment, "YYYY-MM"; null if there was nothing to pay. */
  debtFreeMonth: string | null;
  totalInterestMinor: number;
  totalPaidMinor: number;
  /** When each debt is cleared and what it cost in interest. */
  debts: { id: string; paidOffInMonth: number; paidOffMonth: string | null; interestMinor: number }[];
  schedule: { month: number; date: string; paymentMinor: number; interestMinor: number; remainingMinor: number }[];
  /** True when the payoff runs longer than the schedule returned. */
  scheduleTruncated: boolean;
}

export interface DebtPayoffInfeasible {
  strategy: DebtStrategy;
  feasible: false;
  reason: 'budget_below_minimums' | 'not_paid_off_within_50_years';
  /** The smallest monthly budget that covers every minimum payment. */
  minimumBudgetMinor: number;
}

export type DebtPayoffResult = DebtPayoffPlan | DebtPayoffInfeasible;

function validate(input: DebtPayoffInput) {
  if (!Array.isArray(input.debts) || input.debts.length > 50) {
    throw new CalcError('invalid_input', 'debts must be a list of at most 50 items');
  }
  const seen = new Set<string>();
  const debts = input.debts.map((debt, i) => {
    if (typeof debt.id !== 'string' || debt.id === '' || seen.has(debt.id)) {
      throw new CalcError('invalid_input', `debts[${i}].id must be a unique, non-empty string`);
    }
    seen.add(debt.id);
    return {
      id: debt.id,
      balanceMinor: int(`debts[${i}].balanceMinor`, debt.balanceMinor),
      aprBps: int(`debts[${i}].aprBps`, debt.aprBps, MAX_RATE_BPS),
      minimumPaymentMinor: int(`debts[${i}].minimumPaymentMinor`, debt.minimumPaymentMinor),
    };
  });
  return {
    debts,
    budget: int('monthlyBudgetMinor', input.monthlyBudgetMinor),
    start: toMonth(input.startDate),
    maxSchedule: int('maxScheduleMonths', input.maxScheduleMonths ?? 120, MAX_MONTHS),
  };
}

/** Snowball: smallest balance first. Avalanche: highest rate first. Ties fall back to the other rule, then id. */
function priority(debts: DebtInput[], strategy: DebtStrategy): string[] {
  const bySize = (a: DebtInput, b: DebtInput) => a.balanceMinor - b.balanceMinor;
  const byRate = (a: DebtInput, b: DebtInput) => b.aprBps - a.aprBps;
  const [first, second] = strategy === 'snowball' ? [bySize, byRate] : [byRate, bySize];
  return [...debts]
    .filter((d) => d.balanceMinor > 0)
    .sort((a, b) => first(a, b) || second(a, b) || a.id.localeCompare(b.id))
    .map((d) => d.id);
}

/**
 * Simulates paying debts month by month. Each month: interest is added to every
 * balance, every debt gets its minimum payment, and whatever is left of the budget
 * goes to the first unpaid debt in priority order. When a debt is cleared its
 * payment rolls on to the next one, because the monthly budget stays the same.
 *
 * Assumes fixed rates, interest charged monthly at APR / 12, no fees and no new borrowing.
 */
export function calcDebtPayoff(input: DebtPayoffInput & { strategy: DebtStrategy }): DebtPayoffResult {
  const { debts, budget, start, maxSchedule } = validate(input);
  const { strategy } = input;
  if (strategy !== 'snowball' && strategy !== 'avalanche') {
    throw new CalcError('invalid_input', 'strategy must be "snowball" or "avalanche"');
  }

  // The most the minimum payments can ever come to in one month. A debt's payment is its
  // minimum, or its whole balance plus that month's interest if that is smaller.
  const minimumBudget = debts.reduce(
    (sum, d) => sum + Math.min(d.minimumPaymentMinor, d.balanceMinor + monthlyInterest(d.balanceMinor, d.aprBps)),
    0,
  );
  if (budget < minimumBudget) {
    return { strategy, feasible: false, reason: 'budget_below_minimums', minimumBudgetMinor: minimumBudget };
  }

  const order = priority(debts, strategy);
  const balance = new Map(debts.map((d) => [d.id, d.balanceMinor]));
  const interestBy = new Map(debts.map((d) => [d.id, 0]));
  const paidOffIn = new Map(debts.filter((d) => d.balanceMinor === 0).map((d) => [d.id, 0]));
  const schedule: DebtPayoffPlan['schedule'] = [];
  let month = 0;
  let totalInterest = 0;
  let totalPaid = 0;

  const runaway: DebtPayoffInfeasible = {
    strategy,
    feasible: false,
    reason: 'not_paid_off_within_50_years',
    minimumBudgetMinor: minimumBudget,
  };

  while (paidOffIn.size < debts.length) {
    if (month === MAX_MONTHS) return runaway;
    month += 1;
    let interest = 0;
    let available = budget;

    for (const debt of debts) {
      const owed = balance.get(debt.id)!;
      if (owed === 0) continue;
      const charge = monthlyInterest(owed, debt.aprBps);
      // A balance that has grown a hundredfold past the largest allowed input is never
      // coming back; stop before the numbers stop being exact.
      if (owed + charge > MAX_AMOUNT * 100) return runaway;
      const payment = Math.min(debt.minimumPaymentMinor, owed + charge);
      balance.set(debt.id, owed + charge - payment);
      interestBy.set(debt.id, interestBy.get(debt.id)! + charge);
      interest += charge;
      available -= payment;
    }
    for (const id of order) {
      const owed = balance.get(id)!;
      const payment = Math.min(owed, available);
      balance.set(id, owed - payment);
      available -= payment;
    }
    for (const debt of debts) {
      if (balance.get(debt.id) === 0 && !paidOffIn.has(debt.id)) paidOffIn.set(debt.id, month);
    }

    const payment = budget - available;
    totalInterest += interest;
    totalPaid += payment;
    if (month <= maxSchedule) {
      schedule.push({
        month,
        date: addMonths(start, month - 1),
        paymentMinor: payment,
        interestMinor: interest,
        remainingMinor: [...balance.values()].reduce((a, b) => a + b, 0),
      });
    }
  }

  const monthLabel = (n: number) => (n === 0 ? null : addMonths(start, n - 1));
  return {
    strategy,
    feasible: true,
    priorityOrder: order,
    monthsToDebtFree: month,
    debtFreeMonth: monthLabel(month),
    totalInterestMinor: totalInterest,
    totalPaidMinor: totalPaid,
    debts: debts.map((d) => ({
      id: d.id,
      paidOffInMonth: paidOffIn.get(d.id)!,
      paidOffMonth: monthLabel(paidOffIn.get(d.id)!),
      interestMinor: interestBy.get(d.id)!,
    })),
    schedule,
    scheduleTruncated: month > schedule.length,
  };
}

export interface DebtComparison {
  snowball: DebtPayoffResult;
  avalanche: DebtPayoffResult;
  /** Present when both strategies clear the debt. Positive numbers favour avalanche. */
  difference: { interestSavedByAvalancheMinor: number; monthsSavedByAvalanche: number } | null;
}

/** Runs both strategies on the same debts and budget so they can be compared side by side. */
export function compareDebtStrategies(input: DebtPayoffInput): DebtComparison {
  const snowball = calcDebtPayoff({ ...input, strategy: 'snowball' });
  const avalanche = calcDebtPayoff({ ...input, strategy: 'avalanche' });
  return {
    snowball,
    avalanche,
    difference:
      snowball.feasible && avalanche.feasible
        ? {
            interestSavedByAvalancheMinor: snowball.totalInterestMinor - avalanche.totalInterestMinor,
            monthsSavedByAvalanche: snowball.monthsToDebtFree - avalanche.monthsToDebtFree,
          }
        : null,
  };
}
