import { calcBudget, calcDebtPayoff, calcEmergencyFund, calcSavingsProjection, compareDebtStrategies } from '@fin/calc';
import { z } from 'zod';
import { ASSUMPTIONS, bps, budgetResult, emergencyFundResult, isoDate, minor, MINOR_NOTE, payoffDifference, payoffResult, POSITIONING, toCamel, toSnake } from '../wire';
import { tool } from './define';

// These tools take explicit numbers, read nothing about the user and store nothing.
// They exist so that an agent never has to do the arithmetic itself.

const NOTE = `Reads and stores nothing: it only computes from the numbers you pass. Always use this instead of working figures out yourself. ${MINOR_NOTE} ${ASSUMPTIONS} ${POSITIONING}`;
const startDate = isoDate.optional().describe('First month, as a date. Defaults to the current month.');
const thisMonth = () => new Date().toISOString().slice(0, 10);

const calcBudgetTool = tool({
  name: 'calc_budget',
  title: 'Calculate a budget',
  kind: 'calc',
  scope: null,
  description: `Compare monthly spending with a budgeting rule: 50/30/20 (needs/wants/savings), your own percentage split, or zero-based (every unit of income given a job). Returns target against actual per bucket, the surplus or shortfall, the savings rate and spending per category. ${NOTE}`,
  input: z.strictObject({
    net_income_minor: minor.describe('Monthly take-home income.'),
    expenses: z.array(z.strictObject({ category: z.string().min(1).max(40), amount_minor: minor, essential: z.boolean() })).max(50).describe('Monthly expenses. Essential ones count as needs, the rest as wants.'),
    method: z.union([
      z.enum(['50_30_20', 'zero_based']),
      z.strictObject({ needs_percent: z.number().int().min(0).max(100), wants_percent: z.number().int().min(0).max(100), savings_percent: z.number().int().min(0).max(100) }).describe('Must add up to 100.'),
    ]),
  }),
  output: budgetResult,
  async run(args) {
    return { result: toSnake(calcBudget(toCamel(args))) };
  },
});

const calcDebtPayoffTool = tool({
  name: 'calc_debt_payoff',
  title: 'Calculate debt payoff',
  kind: 'calc',
  scope: null,
  description: `Work out how long a set of debts takes to clear on a fixed monthly budget, and what it costs in interest. snowball pays the smallest balance first; avalanche pays the highest interest rate first; "both" runs the two and gives the difference. If the budget does not cover the minimum payments the result says so and gives the smallest budget that would. ${NOTE}`,
  input: z.strictObject({
    debts: z.array(z.strictObject({ id: z.string().min(1).max(40).describe('Any label you choose, used to refer to this debt in the result.'), balance_minor: minor, apr_bps: bps, minimum_payment_minor: minor })).min(1).max(50),
    monthly_budget_minor: minor.describe('Total available for debt each month, minimum payments included.'),
    strategy: z.enum(['snowball', 'avalanche', 'both']),
    start_date: startDate,
    schedule_months: z.number().int().min(0).max(120).default(24).describe('How many months of the payment schedule to return. Totals always cover the full payoff.'),
  }),
  output: z.strictObject({ snowball: payoffResult.optional(), avalanche: payoffResult.optional(), difference: payoffDifference.nullable().optional().describe('Present for "both" when each strategy clears the debt. Positive numbers favour avalanche.') }),
  async run({ strategy, start_date, schedule_months, ...rest }) {
    const input = { ...toCamel(rest), startDate: start_date ?? thisMonth(), maxScheduleMonths: schedule_months };
    if (strategy === 'both') return { result: toSnake(compareDebtStrategies(input)) };
    return { result: { [strategy]: toSnake(calcDebtPayoff({ ...input, strategy })) } };
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

const calcSavingsProjectionTool = tool({
  name: 'calc_savings_projection',
  title: 'Project savings',
  kind: 'calc',
  scope: null,
  description: `Project a savings balance forward with a fixed monthly contribution and interest rate, and optionally find when it reaches a target. Returns the balance at the end of each year. This illustrates saving at an interest rate you supply; it says nothing about what any product or market will return. ${NOTE}`,
  input: z.strictObject({
    starting_balance_minor: minor,
    monthly_contribution_minor: minor,
    annual_rate_bps: bps.describe('Annual interest rate in basis points: 450 = 4.5%.'),
    months: z.number().int().min(1).max(600),
    target_minor: minor.optional(),
    start_date: startDate,
  }),
  output: z.strictObject({
    final_balance_minor: minor,
    total_contributed_minor: minor,
    total_growth_minor: minor,
    months_to_target: z.number().int().nullable(),
    target_reached_month: z.string().nullable(),
    series: z.array(z.strictObject({ month: z.number().int(), date: z.string(), balance_minor: minor, contributed_minor: minor, growth_minor: minor })),
  }),
  async run({ start_date, ...rest }) {
    return { result: toSnake(calcSavingsProjection({ ...toCamel(rest), startDate: start_date ?? thisMonth() })) };
  },
});

export const calcTools = [calcBudgetTool, calcDebtPayoffTool, calcEmergencyFundTool, calcSavingsProjectionTool];
