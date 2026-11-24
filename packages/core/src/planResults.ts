import {
  calcBudget,
  calcEmergencyFund,
  calcSavingsProjection,
  calcScenarios,
  leanRunShortfall,
  worstShortfall,
  compareDebtStrategies,
  ENGINE_VERSION,
  monthlyInterest,
  type BudgetResult,
  type DebtComparison,
  type EmergencyFundResult,
  type ScenariosResult,
} from '@fin/calc';
import { effectiveGoals } from './funding';
import type { IncomeHistory } from './history';
import { incomeBand, withLeanIncome, type IncomeBand } from './income';
import { toMonthly } from './money';
import type { Goal, Item } from './profile';
import type { PlanInputs } from './schemas';
import { expensesOf, expenseTiers, type ExpenseTiers } from './spending';
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
  /** Only when income varies; `monthly` then describes a lean month. */
  scenarios?: PlanScenarios;
  /** What the emergency fund is and is not sized on, once expenses have been given tiers. */
  spendingTiers?: ExpenseTiers;
  /** The profile's revision when this was worked out, to tell when it has changed since. Absent from older versions. */
  profileRevision?: number;
}

export interface PlanScenarios extends ScenariosResult {
  basis: IncomeBand['basis'];
  /** Spending in the profile that the plan leaves out. The scenarios count it, because it will still be spent. */
  omittedSpendingMinor: number;
  monthsObserved: number;
  /** What it takes to keep paying for essentials through lean months. */
  leanRun: {
    /** `measured`: the deepest hole observed months dug. `assumed`: as many lean months in a row as the plan's emergency fund is meant to last. */
    basis: 'measured' | 'assumed';
    months: number;
    amountMinor: number;
  };
}

/**
 * The expenses in categories the plan leaves out. Planning zero for a category is taken as a
 * decision to cut it, unless any of that spending is marked essential.
 */
function omittedExpenses(items: Item[], inputs: PlanInputs) {
  const planned = new Map<string, number>();
  for (const row of inputs.budget) planned.set(row.category, (planned.get(row.category) ?? 0) + row.amountMinor);
  const expenses = items.filter((item) => item.kind === 'expense').filter((item) => item.amountMinor > 0);
  return expenses.filter(({ category, essential }) => {
    const amount = planned.get(category);
    return amount === undefined || (amount === 0 && essential);
  });
}

/**
 * The planned budget split into needs and wants by what the profile says is survival spending, so
 * that a plan and its emergency fund agree. Used once expenses have been given tiers. A category
 * the profile has nothing in falls back on the usual list.
 */
function byTier(items: Item[], inputs: PlanInputs) {
  const planned = new Map<PlanInputs['budget'][number]['category'], number>();
  for (const row of inputs.budget) planned.set(row.category, (planned.get(row.category) ?? 0) + row.amountMinor);
  return [...planned].flatMap(([category, amountMinor]) => {
    const row = { category, amountMinor };
    const own = expensesOf(items).filter((e) => e.category === row.category);
    if (own.length === 0) return [{ ...row, essential: ESSENTIAL_CATEGORIES.has(row.category) }];
    const needs = Math.min(row.amountMinor, own.reduce((sum, e) => sum + (e.essential ? toMonthly(e.amountMinor, e.frequency) : 0), 0));
    return [{ ...row, amountMinor: needs, essential: true }, { ...row, amountMinor: row.amountMinor - needs, essential: false }];
  });
}

export interface PlanContext {
  /** What check-ins show about income. */
  history?: IncomeHistory;
  profileRevision?: number;
}

export function computePlanResults(items: Item[], storedGoals: Goal[], inputs: PlanInputs, startMonth: string, { history, profileRevision }: PlanContext = {}): PlanResults {
  const band = incomeBand(items, history);
  const summary = withLeanIncome(summarise(items), band);
  const goals = effectiveGoals(storedGoals, items);
  const tiers = expenseTiers(items);
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

  const omitted = omittedExpenses(items, inputs);
  const scenarios: PlanScenarios | undefined = band.varies ? planScenarios() : undefined;

  function planScenarios(): PlanScenarios {
    const essentials = summary.monthlyEssentialExpenses + summary.monthlyDebtMinimums;
    const measured = band.basis === 'measured' && history;
    const omittedSpendingMinor = omitted.reduce((sum, e) => sum + toMonthly(e.amountMinor, e.frequency), 0);
    return {
      basis: band.basis,
      monthsObserved: band.monthsObserved,
      leanRun: measured
        ? { basis: 'measured', months: history.observed.length, amountMinor: worstShortfall(history.runs, essentials) }
        : {
            basis: 'assumed',
            months: inputs.emergencyFundMonths,
            amountMinor: leanRunShortfall({ leanIncomeMinor: band.leanMinor, outgoingsMinor: essentials, months: inputs.emergencyFundMonths }),
          },
      omittedSpendingMinor,
      ...calcScenarios({
        income: band,
        outgoingsMinor: budgeted + omittedSpendingMinor + debtPayments + toGoals,
        essentialOutgoingsMinor: essentials,
        goalContributionsMinor: toGoals,
        bufferMinor: summary.emergencyFund,
      }),
    };
  }

  if (omitted.length > 0) {
    warnings.push({
      code: 'plan_omits_expenses',
      severity: 'warn',
      message: `This plan sets nothing aside for some of the spending in your profile, so ${unallocated < 0 ? 'the real shortfall is larger' : 'the money it shows as left over is too high'}.`,
    });
  }
  if (contributions.length < inputs.goalContributions.length) {
    warnings.push({ code: 'goal_not_active', severity: 'info', message: 'A contribution to a goal that is not active was left out.' });
  }
  if (scenarios) {
    const [lean, typical] = scenarios.scenarios;
    const costs = omitted.length > 0 ? 'this plan and the spending it leaves out come' : 'this plan comes';
    if (lean!.balanceMinor! < 0) {
      warnings.push({ code: 'lean_month_shortfall', severity: 'warn', message: `In a lean month, ${costs} to more than your income.` });
    }
    if (typical!.balanceMinor === null) {
      warnings.push({ code: 'income_uncertain', severity: 'info', message: 'What comes in during a typical month is not recorded, so only a lean month can be worked out. Dates in this plan assume every month can pay for it.' });
    } else if (typical!.balanceMinor < 0) {
      warnings.push({ code: 'plan_exceeds_income', severity: 'warn', message: `Even in a typical month, ${costs} to more than your income.` });
    }
  } else if (unallocated < 0) {
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
          : debtPayments === 0
            ? 'This plan puts nothing towards the debt, so it is never paid off.'
            : debts.reduce((sum, d) => sum + monthlyInterest(d.balanceMinor, d.aprBps), 0) >= debtPayments
              ? 'At this rate the debt is never paid off: interest uses up the payments.'
              : 'At this rate the debt is not paid off within 50 years.',
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
      expenses: tiers.classified ? byTier(items, inputs) : inputs.budget.map((row) => ({ ...row, essential: ESSENTIAL_CATEGORIES.has(row.category) })),
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
    ...(scenarios && { scenarios }),
    ...(tiers.classified && { spendingTiers: tiers }),
    ...(profileRevision !== undefined && { profileRevision }),
  };
}
