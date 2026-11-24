import { calcBudget, calcDebtPayoff, calcEmergencyFund, calcSavingsProjection, compareDebtStrategies, knownScenarios } from '@fin/calc';
import { z } from 'zod';
import { ASSUMPTIONS, bps, budgetResult, emergencyFundResult, isoDate, minor, MINOR_NOTE, orNull, payoffDifference, payoffResult, POSITIONING, scenarioName, toCamel, ToolError, toSnake } from '../wire';
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
  }),
  output: emergencyFundResult,
  async run({ start_date, ...rest }) {
    return { result: toSnake(calcEmergencyFund({ ...toCamel(rest), startDate: start_date ?? thisMonth() })) };
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

export const calcTools = [calcBudgetTool, calcDebtPayoffTool, calcEmergencyFundTool, calcSavingsProjectionTool];
