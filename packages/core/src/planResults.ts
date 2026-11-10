import {
  calcBudget,
  calcEmergencyFund,
  calcSavingsProjection,
  compareDebtStrategies,
  ENGINE_VERSION,
  type BudgetResult,
  type DebtComparison,
  type EmergencyFundResult,
} from '@fin/calc';
import type { Goal, Item } from './profile';
import type { PlanInputs } from './schemas';
import { summarise } from './summary';
import type { Warning } from './warnings';

/** Categories counted as "needs" when a plan's budget is compared with the 50/30/20 rule. */
const ESSENTIAL_CATEGORIES = new Set(['housing', 'utilities', 'food', 'transport', 'health', 'insurance', 'education', 'childcare']);

/**
 * What a plan works out to. Always produced here by the calculation engine from the
 * saved profile and the plan's choices; numbers supplied from outside are never stored.
 */
export interface PlanResults {
  engineVersion: string;
  /** First month the projections count from, "YYYY-MM". */
  startMonth: string;
  /** Where each month's income goes under this plan. */
  monthly: {
    incomeMinor: number;
    budgetedSpendingMinor: number;
    debtPaymentsMinor: number;
    goalContributionsMinor: number;
    /** Income not given a job. Negative means the plan spends more than comes in. */
    unallocatedMinor: number;
  };
  budget: BudgetResult;
  /** Both payoff strategies on the plan's debt budget; null when there is no debt. */
  debt: DebtComparison | null;
  emergencyFund: EmergencyFundResult;
  goals: { goalId: string; monthsToTarget: number | null; targetReachedMonth: string | null }[];
  warnings: Warning[];
}

export function computePlanResults(items: Item[], goals: Goal[], inputs: PlanInputs, startMonth: string): PlanResults {
  const summary = summarise(items);
  const goalById = new Map(goals.map((g) => [g.id, g]));
  // Money can only be planned towards goals that exist and are still being pursued.
  const contributions = inputs.goalContributions.filter((c) => goalById.get(c.goalId)?.status === 'active');
  const warnings: Warning[] = [];

  const budgeted = inputs.budget.reduce((sum, row) => sum + row.amountMinor, 0);
  const debts = items.flatMap((item) =>
    item.kind === 'debt' && item.balanceMinor > 0
      ? [{ id: item.id, balanceMinor: item.balanceMinor, aprBps: item.aprBps, minimumPaymentMinor: item.minimumPaymentMinor }]
      : [],
  );
  const debtPayments = debts.length === 0 ? 0 : summary.monthlyDebtMinimums + inputs.extraDebtPaymentMinor;
  const toGoals = contributions.reduce((sum, c) => sum + c.amountMinor, 0);
  const unallocated = summary.monthlyIncome - budgeted - debtPayments - toGoals;

  if (contributions.length < inputs.goalContributions.length) {
    warnings.push({ code: 'goal_not_active', severity: 'info', message: 'A contribution to a goal that is not active was left out.' });
  }
  if (unallocated < 0) {
    warnings.push({ code: 'plan_exceeds_income', severity: 'warn', message: 'This plan allocates more each month than your recorded income.' });
  }

  const debt = debts.length === 0 ? null : compareDebtStrategies({ debts, monthlyBudgetMinor: debtPayments, startDate: startMonth, maxScheduleMonths: 24 });
  const chosen = debt && inputs.debtStrategy ? debt[inputs.debtStrategy] : null;
  if (chosen && !chosen.feasible) {
    warnings.push({
      code: 'debt_never_cleared',
      severity: 'warn',
      message:
        chosen.reason === 'budget_below_minimums'
          ? 'The debt payments in this plan do not cover the minimum payments.'
          : 'At this rate the debt is never paid off: interest grows faster than the payments.',
    });
  }

  const toEmergencyFund = contributions.reduce((sum, c) => sum + (goalById.get(c.goalId)!.kind === 'emergency_fund' ? c.amountMinor : 0), 0);

  return {
    engineVersion: ENGINE_VERSION,
    startMonth,
    monthly: {
      incomeMinor: summary.monthlyIncome,
      budgetedSpendingMinor: budgeted,
      debtPaymentsMinor: debtPayments,
      goalContributionsMinor: toGoals,
      unallocatedMinor: unallocated,
    },
    budget: calcBudget({
      netIncomeMinor: summary.monthlyIncome,
      expenses: inputs.budget.map((row) => ({ ...row, essential: ESSENTIAL_CATEGORIES.has(row.category) })),
      method: '50_30_20',
    }),
    debt,
    emergencyFund: calcEmergencyFund({
      essentialMonthlyMinor: summary.monthlyEssentialExpenses,
      targetMonths: inputs.emergencyFundMonths,
      currentBalanceMinor: summary.emergencyFund,
      monthlyContributionMinor: toEmergencyFund,
      startDate: startMonth,
    }),
    goals: contributions.map((c) => {
      const goal = goalById.get(c.goalId)!;
      const projection = calcSavingsProjection({
        startingBalanceMinor: goal.currentAmountMinor,
        monthlyContributionMinor: c.amountMinor,
        annualRateBps: 0,
        months: 600,
        targetMinor: goal.targetAmountMinor,
        startDate: startMonth,
      });
      return { goalId: c.goalId, monthsToTarget: projection.monthsToTarget, targetReachedMonth: projection.targetReachedMonth };
    }),
    warnings,
  };
}
