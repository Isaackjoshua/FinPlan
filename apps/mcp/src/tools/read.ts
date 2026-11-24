import {
  ALLOCATION_GROUPS,
  cashFlow,
  checkInVariance,
  effectiveGoals,
  expensesOf,
  expenseTiers,
  getCurrentPlan,
  getLesson,
  getPlanVersion,
  getProfile,
  getProgress,
  GOAL_KINDS,
  GOAL_STATUSES,
  goalFeasibility,
  incomeBand,
  leftOver,
  listAllocations,
  listCheckIns,
  listGoals,
  listIncome,
  listItems,
  listLessons,
  listPlanVersions,
  loadProfileCheck,
  lumpyMonths,
  minorDigits,
  obligations,
  previewAllocation,
  profileScenarios,
  SCOPES,
  TAGS,
  tierOf,
  toMonthly,
  TOPICS,
  type AllocationPlan,
  type Ctx,
  type Goal,
  type Profile,
} from '@fin/core';
import { z } from 'zod';
import {
  band,
  bps,
  category,
  debtKind,
  declaredBasis,
  feasibility,
  frequency,
  goalExtra,
  goalParts,
  include,
  incomeBasis,
  isoDate,
  minor,
  orNull,
  MINOR_NOTE,
  plan,
  planOut,
  POSITIONING,
  scenarioName,
  scenariosResult,
  signedMinor,
  spendingTiers,
  tier,
  totalMinor,
  toSnake,
  ToolError,
  USER_TEXT_NOTE,
  variability,
  variance,
  warning,
} from '../wire';
import { tool } from './define';

/** Every tool that touches user data starts here: no profile means onboarding is not finished. */
export async function needProfile(ctx: Ctx, userId: string): Promise<Profile> {
  const profile = await getProfile(ctx, userId);
  if (!profile) {
    throw new ToolError('The user has not finished setting up FinPlan yet. Ask them to sign in to FinPlan and choose their country and currency, then try again.');
  }
  return profile;
}

const label = z.strictObject({ label: z.string() });
export const today = () => new Date().toISOString().slice(0, 10);

const obligationsOut = ({ items, ...totals }: ReturnType<typeof obligations>) => ({
  ...toSnake(totals),
  bills: items.map(({ label: text, ...bill }) => ({ ...toSnake(bill), user_text: { label: text } })),
});
const detail = z.enum(['summary', 'full']).default('summary').describe('`summary` gives totals; `full` adds the budget breakdown and the month-by-month debt schedule.');

const getProfileTool = tool({
  name: 'get_profile',
  title: 'Get financial profile',
  kind: 'read',
  scope: 'finance:read',
  description: `Read the user's financial profile. By default returns only monthly totals and warnings; ask for line items with \`sections\`, and request only what you need. Read this before proposing changes, and pass the returned \`revision\` to update_profile. ${MINOR_NOTE} ${USER_TEXT_NOTE}`,
  input: z.strictObject({
    sections: z
      .array(z.enum(['summary', 'income', 'expenses', 'debts', 'savings', 'income_band', 'completeness', 'income_plan', 'expense_details', 'obligations']))
      .max(10)
      .default(['summary'])
      .describe(
        'Which parts to return. `summary` is totals only; `income`, `expenses`, `debts` and `savings` are the individual line items. `income_plan` says whether income varies, what a lean, typical and good month work out to, and what those figures rest on, check-ins included. `income_band` is the same from what the user declared alone. `completeness` says whether the profile is complete enough to rely on. `expense_details` gives each expense its tier, its monthly equivalent and its due date. `obligations` lists bills that come less often than monthly, which monthly totals spread out, and what to set aside for them.',
      ),
  }),
  output: z.strictObject({
    currency: z.string(),
    country: z.string(),
    revision: z.number().int(),
    summary: z
      .strictObject({
        monthly_income_minor: minor,
        monthly_expenses_minor: minor,
        monthly_essential_expenses_minor: minor,
        monthly_debt_minimums_minor: minor,
        monthly_surplus_minor: signedMinor,
        total_debt_minor: minor,
        total_savings_minor: minor,
        emergency_fund_minor: minor,
        highest_apr_bps: orNull(bps),
        pay_frequency: frequency.optional(),
        household_size: z.number().int().optional(),
        user_text: z.strictObject({ notes: z.string().optional() }),
        warnings: z.array(warning),
      })
      .optional(),
    income: z.array(z.strictObject({ id: z.string(), amount_minor: minor, frequency, user_text: label })).optional(),
    expenses: z.array(z.strictObject({ id: z.string(), amount_minor: minor, frequency, category, essential: z.boolean(), user_text: label })).optional(),
    debts: z.array(z.strictObject({ id: z.string(), debt_kind: debtKind, balance_minor: minor, apr_bps: bps, minimum_payment_minor: minor, user_text: label })).optional(),
    savings: z.array(z.strictObject({ id: z.string(), balance_minor: minor, apy_bps: bps, is_emergency_fund: z.boolean(), user_text: label })).optional(),
    income_band: z
      .strictObject({
        varies: z.boolean().describe('When true, monthly income and surplus in `summary` describe a lean month.'),
        basis: declaredBasis,
        lean_minor: minor,
        typical_minor: orNull(minor),
        good_minor: orNull(minor),
        sources: z.array(z.strictObject({ id: z.string(), variability, lean_minor: minor, typical_minor: orNull(minor), good_minor: orNull(minor) })).describe('Monthly, per income item.'),
        results: scenariosResult.nullable().describe('Null when income does not vary.'),
      })
      .optional(),
    income_plan: z
      .strictObject({
        varies: z.boolean().describe('When true, monthly income and surplus in `summary` describe a lean month.'),
        basis: incomeBasis,
        lean_minor: totalMinor,
        typical_minor: orNull(totalMinor),
        good_minor: orNull(totalMinor),
        declared: band.describe('What the profile says, whatever was observed.'),
        months_observed: z.number().int(),
        observed: z.array(z.strictObject({ month: z.string(), total_minor: totalMinor })).describe('Months whose income is known from check-ins that cover each day once.'),
        excluded: z.array(z.strictObject({ month: z.string(), reason: z.enum(['gap', 'overlap', 'crosses_month_end', 'income_not_stated']) })).describe('Finished months with check-ins that could not be counted.'),
        results: scenariosResult.nullable().describe('Null when income does not vary.'),
      })
      .optional(),
    completeness: z
      .strictObject({
        surplus_reliable: z.boolean().describe('When false, do not present the surplus as money the user has, or plan on it.'),
        acknowledged: z.array(z.string()).describe('Checks the user has said are right for them.'),
      })
      .optional(),
    expense_details: z
      .strictObject({
        tiers: spendingTiers.describe('Monthly. An emergency fund is sized on survival spending only.'),
        lines: z.array(
          z.strictObject({
            id: z.string(),
            tier,
            amount_minor: minor,
            frequency,
            monthly_minor: minor,
            smoothed: z.boolean().describe('True when the monthly figure spreads out a bill that comes less often.'),
            next_due_date: orNull(z.string()),
            reserved_minor: minor,
          }),
        ),
      })
      .optional(),
    obligations: z
      .strictObject({
        set_aside_minor: minor.describe('Still to set aside this month in all.'),
        steady_monthly_minor: minor,
        smoothed_monthly_minor: minor.describe('How much of the monthly expenses is these bills spread out evenly.'),
        bills: z.array(
          z.strictObject({
            id: z.string(),
            amount_minor: minor,
            frequency,
            reserved_minor: minor.describe('Towards the next bill, once bills whose date has passed are taken as paid from it.'),
            set_aside_minor: minor.describe('Still to set aside this month.'),
            remaining_minor: minor,
            due_date: orNull(z.string()).describe('Null when not known.'),
            due_date_passed: z.boolean().describe('The recorded date has passed; the bill is taken as paid and these figures are for the next one. Ask the user.'),
            months_left: orNull(z.number().int()),
            steady_monthly_minor: minor,
            catch_up_monthly_minor: orNull(minor).describe('What to set aside monthly to have it all in time. Null without a date.'),
            user_text: label,
          }),
        ),
      })
      .optional(),
  }),
  async run({ sections }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    const { items, history, given, band: income, summary: totals, warnings, scenarios, surplusReliable, acknowledged } = await loadProfileCheck(ctx, auth.userId, profile, today());
    const declaredScenarios = profileScenarios({ ...income, ...income.declared }, totals);
    const wants = (section: (typeof sections)[number]) => sections.includes(section);
    // Line items leave their label out of the main object and carry it in `user_text`.
    const lines = (kind: string) =>
      items.filter((item) => item.kind === kind).map(({ kind: _kind, label: text, ...rest }) => ({ ...toSnake(rest), user_text: { label: text } }));
    return {
      result: {
        currency: profile.currency,
        country: profile.country,
        revision: profile.revision,
        ...(wants('summary') && {
          summary: {
            monthly_income_minor: totals.monthlyIncome,
            monthly_expenses_minor: totals.monthlyExpenses,
            monthly_essential_expenses_minor: totals.monthlyEssentialExpenses,
            monthly_debt_minimums_minor: totals.monthlyDebtMinimums,
            monthly_surplus_minor: totals.monthlySurplus,
            total_debt_minor: totals.totalDebt,
            total_savings_minor: totals.totalSavings,
            emergency_fund_minor: totals.emergencyFund,
            highest_apr_bps: totals.highestAprBps,
            ...(profile.payFrequency && { pay_frequency: profile.payFrequency }),
            ...(profile.householdSize && { household_size: profile.householdSize }),
            user_text: profile.notes ? { notes: profile.notes } : {},
            warnings,
          },
        }),
        ...(wants('income') && { income: lines('income') }),
        ...(wants('expenses') && { expenses: lines('expense') }),
        ...(wants('debts') && { debts: lines('debt') }),
        ...(wants('savings') && { savings: lines('savings') }),
        ...(wants('income_band') && {
          income_band: {
            varies: income.varies,
            basis: 'declared' as const,
            ...toSnake(income.declared),
            sources: items.flatMap((item) => {
              if (item.kind !== 'income') return [];
              const one = incomeBand([item]);
              return [{ id: item.id, variability: item.variability ?? 'fixed', lean_minor: one.leanMinor, typical_minor: one.typicalMinor, good_minor: one.goodMinor }];
            }),
            results: declaredScenarios && toSnake(declaredScenarios),
          },
        }),
        ...(wants('income_plan') && {
          income_plan: {
            varies: income.varies,
            basis: income.basis,
            lean_minor: income.leanMinor,
            typical_minor: income.typicalMinor,
            good_minor: income.goodMinor,
            declared: toSnake(income.declared),
            months_observed: income.monthsObserved,
            observed: toSnake(history.observed),
            excluded: history.excluded,
            results: scenarios && toSnake(scenarios),
          },
        }),
        ...(wants('expense_details') && {
          expense_details: {
            tiers: toSnake(expenseTiers(items)),
            lines: expensesOf(items).map((e) => ({
              id: e.id,
              tier: tierOf(e),
              amount_minor: e.amountMinor,
              frequency: e.frequency,
              monthly_minor: toMonthly(e.amountMinor, e.frequency),
              smoothed: lumpyMonths(e.frequency) !== null,
              next_due_date: e.nextDueDate ?? null,
              reserved_minor: e.reservedMinor ?? 0,
            })),
          },
        }),
        ...(wants('obligations') && { obligations: obligationsOut(obligations(items, today(), given)) }),
        ...(wants('completeness') && { completeness: { surplus_reliable: surplusReliable, acknowledged } }),
      },
    };
  },
});

export const partsOut = (goal: Pick<Goal, 'parts'>) => (goal.parts ?? []).map((part) => ({ amount_minor: part.amountMinor, done: part.done, user_text: { label: part.label } }));

const listGoalsTool = tool({
  name: 'list_goals',
  title: 'List goals',
  kind: 'read',
  scope: 'finance:read',
  description: `List the user's financial goals with their targets and progress. ${MINOR_NOTE} ${USER_TEXT_NOTE}`,
  input: z.strictObject({ status: z.enum(GOAL_STATUSES).optional().describe('Only goals with this status. Omit for all.'), include: goalExtra }),
  output: z.strictObject({
    currency: z.string(),
    goals: z.array(
      z.strictObject({
        id: z.string(),
        kind: z.enum(GOAL_KINDS),
        status: z.enum(GOAL_STATUSES),
        priority: z.number().int(),
        target_amount_minor: minor,
        current_amount_minor: minor,
        target_date: orNull(z.string()),
        user_text: z.strictObject({ title: z.string() }),
        funding: z.strictObject({ funding_order: orNull(z.number().int()), monthly_cap_minor: orNull(minor), savings_item_id: orNull(z.string()) }).optional(),
        feasibility: feasibility.optional(),
        parts: goalParts.optional(),
      }),
    ),
  }),
  async run({ status, include: extra }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    const { goals: all, items, summary, scenarios } = await loadProfileCheck(ctx, auth.userId, profile, today());
    const goals = effectiveGoals(all, items).filter((goal) => !status || goal.status === status);
    const left = leftOver(summary, scenarios);
    return {
      result: {
        currency: profile.currency,
        goals: goals.map((goal) => ({
          id: goal.id,
          kind: goal.kind,
          status: goal.status,
          priority: goal.priority,
          target_amount_minor: goal.targetAmountMinor,
          current_amount_minor: goal.currentAmountMinor,
          target_date: goal.targetDate ?? null,
          user_text: { title: goal.title },
          ...(extra?.includes('funding') && { funding: { funding_order: goal.fundingOrder ?? null, monthly_cap_minor: goal.monthlyCapMinor ?? null, savings_item_id: goal.savingsItemId ?? null } }),
          ...(extra?.includes('feasibility') && { feasibility: toSnake(goalFeasibility(goal, left, today())) }),
          ...(extra?.includes('parts') && { parts: partsOut(goal) }),
        })),
      },
    };
  },
});

const planOutput = z.strictObject({ currency: z.string(), plan: plan.nullable() });

const getCurrentPlanTool = tool({
  name: 'get_current_plan',
  title: 'Get current plan',
  kind: 'read',
  scope: 'finance:read',
  description: `Read the plan the user is currently following: the choices in it and the figures the platform computed from them. \`plan\` is null if no plan has been saved yet. ${MINOR_NOTE} ${USER_TEXT_NOTE} ${POSITIONING}`,
  input: z.strictObject({ detail, include }),
  output: planOutput,
  async run({ detail: level, include: extra }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    const current = await getCurrentPlan(ctx, auth.userId);
    return { result: { currency: profile.currency, plan: current ? planOut(current, level, extra, profile) : null } };
  },
});

const getPlanVersionTool = tool({
  name: 'get_plan_version',
  title: 'Get a plan version',
  kind: 'read',
  scope: 'finance:read',
  description: `Read one saved version of the plan by its number, for example to compare it with the current one. ${MINOR_NOTE} ${USER_TEXT_NOTE} ${POSITIONING}`,
  input: z.strictObject({ version: z.number().int().positive(), detail, include }),
  output: planOutput,
  async run({ version, detail: level, include: extra }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    return { result: { currency: profile.currency, plan: planOut(await getPlanVersion(ctx, auth.userId, version), level, extra, profile) } };
  },
});

const listPlanVersionsTool = tool({
  name: 'list_plan_versions',
  title: 'List plan versions',
  kind: 'read',
  scope: 'finance:read',
  description: `List the plan's history, newest first: version number, when and by whom it was saved, and its summary. Every save creates a new version; nothing is overwritten. Only the user can make an older version current again, from the FinPlan website. ${USER_TEXT_NOTE} ${POSITIONING}`,
  input: z.strictObject({
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().regex(/^\d{1,9}$/).optional().describe('`next_cursor` from the previous page.'),
  }),
  output: z.strictObject({
    versions: z.array(
      z.strictObject({
        version: z.number().int(),
        saved_at: z.string(),
        saved_by: z.enum(['user', 'agent']),
        is_current: z.boolean(),
        user_text: z.strictObject({ summary: z.string() }),
      }),
    ),
    next_cursor: orNull(z.string()),
  }),
  async run({ limit, cursor }, auth, { ctx }) {
    const before = cursor ? Number(cursor) : Infinity;
    const older = (await listPlanVersions(ctx, auth.userId)).filter((v) => v.version < before);
    const page = older.slice(0, limit);
    return {
      result: {
        versions: page.map((v) => ({
          version: v.version,
          saved_at: v.savedAt.toISOString(),
          saved_by: v.savedBy,
          is_current: v.isCurrent,
          user_text: { summary: v.summary },
        })),
        next_cursor: older.length > limit ? String(page.at(-1)!.version) : null,
      },
    };
  },
});

const listCheckInsTool = tool({
  name: 'list_check_ins',
  title: 'List check-ins',
  kind: 'read',
  scope: 'finance:read',
  description: `List the user's check-ins, newest first: what they actually earned, spent, paid towards debt and saved in a period, and how that compares with the plan that was current then. In \`variance\`, planned monthly figures are scaled to the length of the period, and a positive difference means more than planned. ${MINOR_NOTE} ${USER_TEXT_NOTE}`,
  input: z.strictObject({
    since: isoDate.optional().describe('Only check-ins whose period ends on or after this date.'),
    limit: z.number().int().min(1).max(50).default(12),
  }),
  output: z.strictObject({
    currency: z.string(),
    check_ins: z.array(
      z.strictObject({
        id: z.string(),
        period_start: z.string(),
        period_end: z.string(),
        logged_at: z.string(),
        logged_by: z.enum(['user', 'agent']),
        actuals: z.strictObject({
          income_minor: minor,
          spending: z.array(z.strictObject({ category, amount_minor: minor })),
          debt_payments_minor: minor,
          savings_added_minor: minor,
        }),
        variance: variance.nullable(),
        user_text: z.strictObject({ note: z.string().optional() }),
      }),
    ),
  }),
  async run({ since, limit }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    const all = await listCheckIns(ctx, auth.userId, 120);
    const page = all.filter((c) => !since || c.periodEnd >= since).slice(0, limit);
    const versions = page.some((c) => c.planVersionId) ? await listPlanVersions(ctx, auth.userId) : [];
    return {
      result: {
        currency: profile.currency,
        check_ins: page.map((c) => {
          const planThen = versions.find((v) => v.id === c.planVersionId);
          return {
            id: c.id,
            period_start: c.periodStart,
            period_end: c.periodEnd,
            logged_at: c.loggedAt.toISOString(),
            logged_by: c.loggedBy,
            actuals: toSnake(c.actuals),
            variance: planThen ? toSnake(checkInVariance(c, planThen)) : null,
            user_text: c.note ? { note: c.note } : {},
          };
        }),
      },
    };
  },
});

const getProgressTool = tool({
  name: 'get_progress',
  title: 'Get progress',
  kind: 'read',
  scope: 'finance:read',
  description: `A compact picture of how the user is getting on: progress towards each goal, current debt and savings, plan and check-in history, and lessons assigned and completed. Use this for a quick status before reading anything in detail. ${MINOR_NOTE}`,
  input: z.strictObject({}),
  output: z.strictObject({
    currency: z.string(),
    goals: z.array(z.strictObject({ id: z.string(), status: z.string(), percent: z.number().int(), remaining_minor: minor })),
    total_debt_minor: minor,
    total_savings_minor: minor,
    emergency_fund_minor: minor,
    plan: z.strictObject({ versions: z.number().int(), current_version: orNull(z.number().int()), last_saved_at: orNull(z.string()) }),
    check_ins: z.strictObject({
      count: z.number().int(),
      last_period_end: orNull(z.string()),
      debt_payments_logged_minor: minor,
      savings_added_logged_minor: minor,
    }),
    lessons: z.strictObject({
      assigned: z.number().int(),
      completed: z.number().int(),
      quizzes: z.array(z.strictObject({ slug: z.string(), best_score: z.number().int() })),
    }),
  }),
  async run(_args, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    return { result: { ...toSnake(await getProgress(ctx, auth.userId)), currency: profile.currency } };
  },
});

// --- Money arriving and being shared out -------------------------------------------

const listIncomeTool = tool({
  name: 'list_income',
  title: 'List income received',
  kind: 'read',
  scope: 'finance:read',
  description: `List money the user has recorded as arriving, newest first, with the day it came. This is separate from the income they expect, which is in get_profile. ${MINOR_NOTE} ${USER_TEXT_NOTE}`,
  input: z.strictObject({ since: isoDate.optional().describe('Only money that came on or after this date.'), limit: z.number().int().min(1).max(100).default(30) }),
  output: z.strictObject({
    currency: z.string(),
    total_minor: totalMinor.describe('The total of what is listed.'),
    income: z.array(z.strictObject({ id: z.string(), received_on: z.string(), amount_minor: minor, item_id: orNull(z.string()), logged_by: z.enum(['user', 'agent']), user_text: z.strictObject({ source: z.string().optional() }) })),
  }),
  async run({ since, limit }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    const all = await listIncome(ctx, auth.userId, { sinceMonth: since?.slice(0, 7) });
    const page = all.filter((r) => !since || r.receivedOn >= since).slice(0, limit);
    return {
      result: {
        currency: profile.currency,
        total_minor: page.reduce((sum, r) => sum + r.amountMinor, 0),
        income: page.map((r) => ({ id: r.id, received_on: r.receivedOn, amount_minor: r.amountMinor, item_id: r.itemId ?? null, logged_by: r.loggedBy, user_text: r.source ? { source: r.source } : {} })),
      },
    };
  },
});

const getCashFlowTool = tool({
  name: 'get_cash_flow',
  title: 'Get cash flow',
  kind: 'read',
  scope: 'finance:read',
  description: `Run the user's recorded income, bills and debt payments forward day by day from what they can spend today, to see whether money runs out before income arrives. Income that comes between two days is taken to come on the last. Anything without a recorded date is listed in \`undated\` and left out, and the result is then partial: say so, and do not guess dates. ${MINOR_NOTE} ${POSITIONING}`,
  input: z.strictObject({
    opening_balance_minor: minor.optional().describe('What the user can spend on the first day. Omit to use what they recorded in FinPlan.'),
    days: z.number().int().min(1).max(366).default(60),
    scenario: scenarioName.default('lean').describe('Which kind of month to assume for income that varies.'),
  }),
  output: z.strictObject({
    currency: z.string(),
    scenario: scenarioName,
    start_date: z.string(),
    end_date: z.string(),
    opening_minor: minor,
    opening_as_of: orNull(z.string()).describe('When the opening balance was recorded, if it was not given.'),
    end_minor: signedMinor,
    money_in_minor: totalMinor,
    money_out_minor: totalMinor,
    lowest: z.strictObject({ date: z.string(), balance_minor: signedMinor }),
    first_short_date: orNull(z.string()).describe('The first day there is not enough.'),
    partial: z.boolean().describe('True when anything below was left out or assumed.'),
    assumed_paid: z.array(z.strictObject({ id: z.string(), date: z.string() })).describe('Big bills whose date has passed without being marked paid. They are taken as paid; ask the user.'),
    unmatched_receipts_minor: totalMinor.describe('Money received this month that is not linked to one of several incomes, so that income may be counted twice. Ask the user which it was.'),
    undated: z.array(z.strictObject({ id: z.string(), kind: z.enum(['income', 'expense', 'debt']) })),
    points: z.array(z.strictObject({ date: z.string(), change_minor: signedMinor, balance_minor: signedMinor, ids: z.array(z.string()) })),
  }),
  async run({ opening_balance_minor, days, scenario }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    const cash = opening_balance_minor === undefined ? profile.cashOnHand : undefined;
    if (opening_balance_minor === undefined && !cash) throw new ToolError('Ask the user how much they can spend today and pass it as `opening_balance_minor`: none is recorded.');
    const day = today();
    const [{ items, band: income }, receipts] = await Promise.all([loadProfileCheck(ctx, auth.userId, profile, day), listIncome(ctx, auth.userId, { sinceMonth: day.slice(0, 7) })]);
    const openingAsOf = cash ? { date: cash.asOf, recordedAt: cash.recordedAt } : { date: day, recordedAt: new Date().toISOString() };
    const flow = cashFlow(items, { openingMinor: opening_balance_minor ?? cash!.amountMinor, openingAsOf, startDate: day, days, scenario, band: income, receipts });
    return { result: { ...toSnake(flow), currency: profile.currency, opening_as_of: cash?.asOf ?? null } };
  },
});

const allocationLines = z.array(
  z.strictObject({
    group: z.enum(ALLOCATION_GROUPS).describe('In order: survival costs, money set aside for big bills, minimum debt payments, committed costs, goals, the rest of the spending. Big bills the user could do without come last of all.'),
    id: z.string().describe('The expense, debt or goal.'),
    wanted_minor: totalMinor,
    allocated_minor: minor,
    unmet_minor: totalMinor,
  }),
);
export const allocationPlan = { available_minor: minor, allocated_minor: minor, left_minor: minor, lines: allocationLines };
export const allocationOut = (plan: AllocationPlan) => toSnake(plan);

const previewAllocationTool = tool({
  name: 'preview_allocation',
  title: 'Preview sharing out money',
  kind: 'read',
  scope: 'finance:read',
  description: `Work out how an amount of money the user has now would be shared out, in a fixed order: survival costs, money set aside for big bills, minimum debt payments, committed costs, goals in line, then the rest, big bills the user could do without included. Each gets what it still needs this month before the next gets anything. Stores nothing. ${MINOR_NOTE} ${POSITIONING}`,
  input: z.strictObject({ available_minor: minor.describe('The money to share out.') }),
  output: z.strictObject({ currency: z.string(), ...allocationPlan }),
  async run({ available_minor }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    return { result: { currency: profile.currency, ...allocationOut(await previewAllocation(ctx, auth.userId, available_minor, today())) } };
  },
});

const listAllocationsTool = tool({
  name: 'list_allocations',
  title: 'List shared-out money',
  kind: 'read',
  scope: 'finance:read',
  description: `List how money has been shared out, newest first. A proposed one has changed nothing yet: only the user can confirm it, on the FinPlan website, once the money has moved. ${MINOR_NOTE}`,
  input: z.strictObject({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe('Only this month, as 2026-11.'), limit: z.number().int().min(1).max(50).default(10) }),
  output: z.strictObject({
    currency: z.string(),
    allocations: z.array(z.strictObject({ id: z.string(), month: z.string(), status: z.enum(['proposed', 'confirmed', 'discarded']), made_by: z.enum(['user', 'agent']), made_at: z.string(), ...allocationPlan })),
  }),
  async run({ month, limit }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    return { result: { currency: profile.currency, allocations: (await listAllocations(ctx, auth.userId, { month, limit })).map((a) => allocationOut(a)) as never } };
  },
});

// --- About the connection ----------------------------------------------------------

const getCapabilitiesTool = tool({
  name: 'get_capabilities',
  title: 'Get capabilities',
  kind: 'catalogue',
  scope: null,
  description: "What this connection may do, and how the user's currency is written as whole minor units. Call this before preparing a change, rather than finding out that it is not allowed.",
  input: z.strictObject({}),
  output: z.strictObject({
    can_read: z.boolean(),
    can_write: z.boolean(),
    tools_needing_permission: z.array(z.string()).describe('Tools this connection lacks permission for. Calling one asks the user to grant it.'),
    currency: z
      .strictObject({ code: z.string(), decimals: z.number().int(), one_thousand_minor: minor.describe('How an amount of one thousand is passed to and returned by every tool.') })
      .nullable()
      .describe('Null without permission to read, or before the user has set FinPlan up.'),
  }),
  async run(_args, auth, { ctx, scopeOf }) {
    const can = (scope: (typeof SCOPES)[number]) => auth.scopes.includes(scope);
    const profile = can('finance:read') ? await getProfile(ctx, auth.userId) : null;
    const decimals = profile && minorDigits(profile.currency);
    return {
      result: {
        can_read: can('finance:read'),
        can_write: can('finance:write'),
        tools_needing_permission: Object.entries(scopeOf()).flatMap(([name, scope]) => (scope && !can(scope) ? [name] : [])),
        currency: profile && decimals !== null ? { code: profile.currency, decimals, one_thousand_minor: 1000 * 10 ** decimals } : null,
      },
    };
  },
});

// --- Lesson catalogue: our own content, the same for everyone -----------------------

const lessonCard = {
  slug: z.string(),
  title: z.string(),
  topic: z.enum(TOPICS),
  difficulty: z.number().int().describe('1 = no background needed, 3 = more involved.'),
  minutes: z.number().int(),
  tags: z.array(z.string()),
};

const listLessonsTool = tool({
  name: 'list_lessons',
  title: 'List lessons',
  kind: 'catalogue',
  scope: null,
  description: 'Browse the short financial-literacy lessons available on FinPlan, optionally filtered. Use the `slug` with get_lesson or assign_lessons.',
  input: z.strictObject({
    topic: z.enum(TOPICS).optional(),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    tag: z.enum(TAGS).optional(),
  }),
  output: z.strictObject({ lessons: z.array(z.strictObject(lessonCard)) }),
  async run(filter) {
    return {
      result: {
        lessons: listLessons(filter).map((l) => ({ slug: l.slug, title: l.title, topic: l.topic, difficulty: l.difficulty, minutes: l.minutes, tags: l.tags })),
      },
    };
  },
});

const getLessonTool = tool({
  name: 'get_lesson',
  title: 'Get lesson details',
  kind: 'catalogue',
  scope: null,
  description: 'What one lesson covers: its summary, learning objectives and quiz length, with a link. The full lesson and its quiz are read by the user on FinPlan, where their progress is recorded; do not attempt to reproduce the lesson.',
  input: z.strictObject({ slug: z.string().max(80) }),
  output: z.strictObject({ ...lessonCard, summary: z.string(), objectives: z.array(z.string()), quiz_question_count: z.number().int(), url: z.string() }),
  async run({ slug }, _auth, { appUrl }) {
    const l = getLesson(slug);
    return {
      result: {
        slug: l.slug,
        title: l.title,
        topic: l.topic,
        difficulty: l.difficulty,
        minutes: l.minutes,
        tags: l.tags,
        summary: l.summary,
        objectives: l.objectives,
        quiz_question_count: l.quiz.length,
        url: `${appUrl}/lessons/${l.slug}`,
      },
    };
  },
});

export const readTools = [
  getProfileTool,
  listGoalsTool,
  getCurrentPlanTool,
  listPlanVersionsTool,
  getPlanVersionTool,
  listCheckInsTool,
  getProgressTool,
  listIncomeTool,
  getCashFlowTool,
  previewAllocationTool,
  listAllocationsTool,
  getCapabilitiesTool,
  listLessonsTool,
  getLessonTool,
];
