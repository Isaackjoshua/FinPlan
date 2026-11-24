import {
  calcAllocation,
  calcBudget,
  calcCashFlow,
  calcDebtPayoff,
  calcEmergencyFund,
  calcSavingsProjection,
  calcSinkingFund,
  calcTotals,
  compareDebtStrategies,
  knownScenarios,
  leanRunShortfall,
  worstShortfall,
} from '@fin/calc';
import { lumpyMonths, PER_YEAR } from '@fin/core';
import { z } from 'zod';
import { ASSUMPTIONS, bps, budgetResult, emergencyFundResult, frequency, isoDate, minor, MINOR_NOTE, orNull, payoffDifference, payoffResult, POSITIONING, scenarioName, signedMinor, toCamel, totalMinor, ToolError, toSnake } from '../wire';
import { tool } from './define';

// These tools take explicit numbers, read nothing about the user and store nothing.
// They exist so that an agent never has to do the arithmetic itself.

const NOTE = `Reads and stores nothing: it only computes from the numbers you pass. Always use this instead of working figures out yourself. ${MINOR_NOTE} ${ASSUMPTIONS} ${POSITIONING}`;
const startDate = isoDate.optional().describe('First month, as a date. Defaults to the current month.');
const scenarioSet = z
  .strictObject({ lean_minor: minor, typical_minor: minor.optional(), good_minor: minor.optional() })
  .optional();
type ScenarioSet = z.infer<typeof scenarioSet>;
const INSTEAD = 'For an amount that varies from month to month, give this instead. Leave out a kind of month whose figure is not known.';
const RAN = 'Only when a varying amount was given: one result for each kind of month that is known. The main result is the lean one.';

/**
 * Runs a calculation for one amount, or for each known kind of month. The main result has the
 * same shape either way; the labelled set is added only for callers that asked for it.
 */
function forEachScenario(field: string, amount: number | undefined, set: ScenarioSet, run: (amountMinor: number) => object) {
  if ((amount === undefined) === (set === undefined)) throw new ToolError(`Give either \`${field}\` or its varying form, not both.`);
  if (!set) return run(amount!);
  const known = knownScenarios({ leanMinor: set.lean_minor, typicalMinor: set.typical_minor ?? null, goodMinor: set.good_minor ?? null });
  const scenarios = known.map(({ scenario, amountMinor }) => ({ scenario, result: run(amountMinor) }));
  return { ...scenarios[0]!.result, scenarios };
}
const scenarioResults = <T extends z.ZodType>(result: T) => z.array(z.strictObject({ scenario: scenarioName, result })).optional().describe(RAN);

const thisMonth = () => new Date().toISOString().slice(0, 10);

const calcBudgetTool = tool({
  name: 'calc_budget',
  title: 'Calculate a budget',
  kind: 'calc',
  scope: null,
  description: `Compare monthly spending with a budgeting rule: 50/30/20 (needs/wants/savings), your own percentage split, or zero-based (every unit of income given a job). Returns target against actual per bucket, the surplus or shortfall, the savings rate and spending per category. ${NOTE}`,
  input: z.strictObject({
    net_income_minor: minor.optional().describe('Monthly take-home income.'),
    net_income_scenarios: scenarioSet.describe(`${INSTEAD} Replaces net_income_minor.`),
    expenses: z.array(z.strictObject({ category: z.string().min(1).max(40), amount_minor: minor, essential: z.boolean() })).max(50).describe('Monthly expenses. Essential ones count as needs, the rest as wants.'),
    method: z.union([
      z.enum(['50_30_20', 'zero_based']),
      z.strictObject({ needs_percent: z.number().int().min(0).max(100), wants_percent: z.number().int().min(0).max(100), savings_percent: z.number().int().min(0).max(100) }).describe('Must add up to 100.'),
    ]),
  }),
  output: budgetResult.extend({ scenarios: scenarioResults(budgetResult) }),
  async run({ net_income_minor, net_income_scenarios, ...rest }) {
    return { result: forEachScenario('net_income_minor', net_income_minor, net_income_scenarios, (netIncomeMinor) => toSnake(calcBudget({ ...toCamel(rest), netIncomeMinor }))) as never };
  },
});

const payoffAnswer = z.strictObject({
  snowball: payoffResult.optional(),
  avalanche: payoffResult.optional(),
  difference: payoffDifference.nullable().optional().describe('Present for "both" when each strategy clears the debt. Positive numbers favour avalanche.'),
});

const calcDebtPayoffTool = tool({
  name: 'calc_debt_payoff',
  title: 'Calculate debt payoff',
  kind: 'calc',
  scope: null,
  description: `Work out how long a set of debts takes to clear on a fixed monthly budget, and what it costs in interest. snowball pays the smallest balance first; avalanche pays the highest interest rate first; "both" runs the two and gives the difference. If the budget does not cover the minimum payments the result says so and gives the smallest budget that would. ${NOTE}`,
  input: z.strictObject({
    debts: z.array(z.strictObject({ id: z.string().min(1).max(40).describe('Any label you choose, used to refer to this debt in the result.'), balance_minor: minor, apr_bps: bps, minimum_payment_minor: minor })).min(1).max(50),
    monthly_budget_minor: minor.optional().describe('Total available for debt each month, minimum payments included.'),
    monthly_budget_scenarios: scenarioSet.describe(`${INSTEAD} Replaces monthly_budget_minor. Each result assumes every month is of that kind.`),
    strategy: z.enum(['snowball', 'avalanche', 'both']),
    start_date: startDate,
    schedule_months: z.number().int().min(0).max(120).default(24).describe('How many months of the payment schedule to return. Totals always cover the full payoff.'),
  }),
  output: payoffAnswer.extend({ scenarios: scenarioResults(payoffAnswer) }),
  async run({ strategy, start_date, schedule_months, monthly_budget_minor, monthly_budget_scenarios, ...rest }) {
    const pay = (monthlyBudgetMinor: number): object => {
      const input = { ...toCamel(rest), monthlyBudgetMinor, startDate: start_date ?? thisMonth(), maxScheduleMonths: schedule_months };
      return strategy === 'both' ? toSnake(compareDebtStrategies(input)) : { [strategy]: toSnake(calcDebtPayoff({ ...input, strategy })) };
    };
    return { result: forEachScenario('monthly_budget_minor', monthly_budget_minor, monthly_budget_scenarios, pay) as never };
  },
});

const calcEmergencyFundTool = tool({
  name: 'calc_emergency_fund',
  title: 'Calculate an emergency fund',
  kind: 'calc',
  scope: null,
  description: `Size an emergency fund as a number of months of essential spending, and work out how long it takes to fill at a given monthly contribution. Ignores interest, to stay conservative. ${NOTE}`,
  input: z.strictObject({
    essential_monthly_minor: minor.describe('Monthly spending on essentials only.'),
    target_months: z.number().int().min(0).max(60),
    current_balance_minor: minor,
    monthly_contribution_minor: minor,
    start_date: startDate,
    volatility: z
      .union([
        z.strictObject({ lean_income_minor: minor, lean_months: z.number().int().min(1).max(60) }).describe('A lean month and how many of them in a row to be ready for.'),
        z.strictObject({ monthly_incomes_minor: z.array(minor).min(1).max(60) }).describe('Actual income of consecutive months, oldest first.'),
      ])
      .optional()
      .describe('For income that varies: also works out what it takes to keep paying for essentials through lean months.'),
  }),
  output: emergencyFundResult.extend({
    volatility: z
      .strictObject({ basis: z.enum(['assumed', 'measured']), target_minor: totalMinor, gap_minor: totalMinor })
      .optional()
      .describe('Only when asked for. Shown beside the months-of-essentials target, not added to it.'),
  }),
  async run({ start_date, volatility, ...rest }) {
    const result = toSnake(calcEmergencyFund({ ...toCamel(rest), startDate: start_date ?? thisMonth() }));
    if (!volatility) return { result };
    const essentials = rest.essential_monthly_minor;
    const target =
      'lean_months' in volatility
        ? leanRunShortfall({ leanIncomeMinor: volatility.lean_income_minor, outgoingsMinor: essentials, months: volatility.lean_months })
        : worstShortfall([volatility.monthly_incomes_minor], essentials);
    return {
      result: {
        ...result,
        volatility: { basis: 'lean_months' in volatility ? 'assumed' : 'measured', target_minor: target, gap_minor: Math.max(0, target - rest.current_balance_minor) },
      } as never,
    };
  },
});

const savingsAnswer = z.strictObject({
  final_balance_minor: minor,
  total_contributed_minor: minor,
  total_growth_minor: minor,
  months_to_target: orNull(z.number().int()),
  target_reached_month: orNull(z.string()),
  series: z.array(z.strictObject({ month: z.number().int(), date: z.string(), balance_minor: minor, contributed_minor: minor, growth_minor: minor })),
});

const calcSavingsProjectionTool = tool({
  name: 'calc_savings_projection',
  title: 'Project savings',
  kind: 'calc',
  scope: null,
  description: `Project a savings balance forward with a fixed monthly contribution and interest rate, and optionally find when it reaches a target. Returns the balance at the end of each year. This illustrates saving at an interest rate you supply; it says nothing about what any product or market will return. ${NOTE}`,
  input: z.strictObject({
    starting_balance_minor: minor,
    monthly_contribution_minor: minor.optional(),
    monthly_contribution_scenarios: scenarioSet.describe(`${INSTEAD} Replaces monthly_contribution_minor. Each result assumes every month is of that kind.`),
    annual_rate_bps: bps.describe('Annual interest rate in basis points: 450 = 4.5%.'),
    months: z.number().int().min(1).max(600),
    target_minor: minor.optional(),
    start_date: startDate,
  }),
  output: savingsAnswer.extend({ scenarios: scenarioResults(savingsAnswer) }),
  async run({ start_date, monthly_contribution_minor, monthly_contribution_scenarios, ...rest }) {
    const project = (monthlyContributionMinor: number): object => toSnake(calcSavingsProjection({ ...toCamel(rest), monthlyContributionMinor, startDate: start_date ?? thisMonth() }));
    return { result: forEachScenario('monthly_contribution_minor', monthly_contribution_minor, monthly_contribution_scenarios, project) as never };
  },
});

const calcTotalsTool = tool({
  name: 'calc_totals',
  title: 'Add up amounts',
  kind: 'calc',
  scope: null,
  description: `Add up a list of amounts that come at different intervals. Returns what each comes to in an average month and in a year, totals per group, and grand totals. ${NOTE}`,
  input: z.strictObject({
    lines: z.array(z.strictObject({ id: z.string().min(1).max(40).describe('Any label you choose.'), amount_minor: minor, frequency, group: z.string().min(1).max(40).optional() })).min(1).max(100),
  }),
  output: z.strictObject({
    lines: z.array(z.strictObject({ id: z.string(), amount_minor: minor, monthly_minor: totalMinor, yearly_minor: totalMinor })),
    groups: z.array(z.strictObject({ group: z.string(), monthly_minor: totalMinor, yearly_minor: totalMinor })),
    monthly_minor: totalMinor,
    yearly_minor: totalMinor,
  }),
  async run({ lines }) {
    return { result: toSnake(calcTotals({ lines: lines.map((l) => ({ id: l.id, amountMinor: l.amount_minor, timesPerYear: PER_YEAR[l.frequency], group: l.group })) })) };
  },
});

const calcSinkingFundTool = tool({
  name: 'calc_sinking_fund',
  title: 'Calculate a sinking fund',
  kind: 'calc',
  scope: null,
  description: `Work out what to set aside each month for a bill that comes less often than monthly: a steady amount that is always enough, and, when the due date is known, what it takes to have it all in time. ${NOTE}`,
  input: z.strictObject({
    amount_minor: minor,
    frequency: frequency.describe('How often it comes: quarterly, every_six_months or yearly.'),
    reserved_minor: minor.default(0).describe('Already set aside for the next one.'),
    next_due_date: isoDate.optional(),
    start_date: isoDate.optional().describe('Today unless given.'),
  }),
  output: z.strictObject({
    steady_monthly_minor: minor,
    remaining_minor: minor,
    reserved_minor: minor,
    due_date: orNull(z.string()),
    due_date_passed: z.boolean(),
    months_left: orNull(z.number().int()),
    catch_up_monthly_minor: orNull(minor),
  }),
  async run({ amount_minor, frequency: every, reserved_minor, next_due_date, start_date }) {
    const everyMonths = lumpyMonths(every);
    if (everyMonths === null) throw new ToolError('A sinking fund is for a bill that comes less often than monthly.');
    return { result: toSnake(calcSinkingFund({ amountMinor: amount_minor, everyMonths, reservedMinor: reserved_minor, nextDueDate: next_due_date, today: start_date ?? thisMonth() })) };
  },
});

const calcCashFlowTool = tool({
  name: 'calc_cash_flow',
  title: 'Calculate a cash flow',
  kind: 'calc',
  scope: null,
  description: `Run a balance forward through dated amounts and find its lowest point and the first day there is not enough. On a day with money in and out, the money out goes first. ${NOTE}`,
  input: z.strictObject({
    opening_balance_minor: minor,
    start_date: isoDate,
    days: z.number().int().min(1).max(366),
    events: z.array(z.strictObject({ id: z.string().min(1).max(40), date: isoDate, amount_minor: signedMinor.describe('Positive for money in, negative for money out.') })).max(300),
  }),
  output: z.strictObject({
    end_date: z.string(),
    end_minor: signedMinor,
    money_in_minor: totalMinor,
    money_out_minor: totalMinor,
    lowest: z.strictObject({ date: z.string(), balance_minor: signedMinor }),
    first_short_date: orNull(z.string()),
    points: z.array(z.strictObject({ date: z.string(), change_minor: signedMinor, balance_minor: signedMinor, ids: z.array(z.string()) })),
  }),
  async run({ opening_balance_minor, start_date, days, events }) {
    return { result: toSnake(calcCashFlow({ openingMinor: opening_balance_minor, startDate: start_date, days, events: toCamel(events) })) };
  },
});

const calcAllocationTool = tool({
  name: 'calc_allocation',
  title: 'Share out an amount',
  kind: 'calc',
  scope: null,
  description: `Share out an amount in the order given: each step gets what it needs, up to its cap, before the next gets anything. To share out the user's own money by their own profile, use preview_allocation. ${NOTE}`,
  input: z.strictObject({
    available_minor: minor,
    steps: z.array(z.strictObject({ id: z.string().min(1).max(40), need_minor: minor, cap_minor: minor.optional() })).min(1).max(50),
  }),
  output: z.strictObject({
    available_minor: minor,
    lines: z.array(z.strictObject({ id: z.string(), wanted_minor: minor, allocated_minor: minor, unmet_minor: minor })),
    allocated_minor: minor,
    left_minor: minor,
    first_unmet_id: orNull(z.string()),
  }),
  async run(args) {
    return { result: toSnake(calcAllocation(toCamel(args))) };
  },
});

export const calcTools = [calcBudgetTool, calcDebtPayoffTool, calcEmergencyFundTool, calcSavingsProjectionTool, calcTotalsTool, calcSinkingFundTool, calcCashFlowTool, calcAllocationTool];
