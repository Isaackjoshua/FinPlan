import { add, CalcError, int } from './util';

export const SCENARIOS = ['lean', 'typical', 'good'] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

/** A figure for each kind of month. Only the lean one has to be known. */
export interface Band {
  leanMinor: number;
  typicalMinor: number | null;
  goodMinor: number | null;
}

export interface ScenariosInput {
  income: Band;
  /** Everything that goes out in a month, goal contributions included. */
  outgoingsMinor: number;
  /** The part of it that cannot be skipped: essentials and minimum debt payments. */
  essentialOutgoingsMinor: number;
  /** The part of `outgoingsMinor` that is set aside for goals. */
  goalContributionsMinor: number;
  /** Savings that can be drawn on in a lean month. */
  bufferMinor: number;
}

export interface Scenario {
  scenario: ScenarioName;
  /** Null when no figure for this kind of month is known, and so for everything below. */
  incomeMinor: number | null;
  /** Income minus all outgoings. Negative means a shortfall. */
  balanceMinor: number | null;
  /** Income minus essential outgoings only. */
  essentialsBalanceMinor: number | null;
  /** How much of the goal contributions such a month can pay for, after everything else. */
  goalFundingMinor: number | null;
}

export interface ScenariosResult {
  /** Always lean, typical, good, in that order. */
  scenarios: Scenario[];
  /** The income at which a month balances. */
  breakEvenMinor: number;
  essentialsBreakEvenMinor: number;
  /** Lean months the buffer makes up for, to one decimal place; null when a lean month has no shortfall. */
  leanMonthsCovered: number | null;
  leanMonthsOfEssentialsCovered: number | null;
}

/** Sums of many items may pass the limit for one amount; they only have to stay exact. */
const MAX_TOTAL = Math.floor(Number.MAX_SAFE_INTEGER / 10);

/** Checks a band: whole amounts, never lower in a better month. */
export function checkBand(band: Band): Band {
  const lean = int('leanMinor', band.leanMinor, MAX_TOTAL);
  const typical = band.typicalMinor === null ? null : int('typicalMinor', band.typicalMinor, MAX_TOTAL);
  const good = band.goodMinor === null ? null : int('goodMinor', band.goodMinor, MAX_TOTAL);
  if ((typical ?? lean) < lean || (good ?? typical ?? lean) < (typical ?? lean)) {
    throw new CalcError('invalid_input', 'A typical month cannot be below a lean one, nor a good month below a typical one');
  }
  return { leanMinor: lean, typicalMinor: typical, goodMinor: good };
}

/** The figures that are known, each with the kind of month it describes. */
export function knownScenarios(band: Band): { scenario: ScenarioName; amountMinor: number }[] {
  const { leanMinor, typicalMinor, goodMinor } = checkBand(band);
  return ([['lean', leanMinor], ['typical', typicalMinor], ['good', goodMinor]] as const).flatMap(([scenario, amountMinor]) =>
    amountMinor === null ? [] : [{ scenario, amountMinor }],
  );
}

/**
 * How a lean, a typical and a good month work out when income varies. A kind of month whose
 * income is not known stays unknown: nothing is estimated from the others.
 */
export function calcScenarios(input: ScenariosInput): ScenariosResult {
  const outgoings = int('outgoingsMinor', input.outgoingsMinor, MAX_TOTAL);
  const essentials = int('essentialOutgoingsMinor', input.essentialOutgoingsMinor, MAX_TOTAL);
  const toGoals = int('goalContributionsMinor', input.goalContributionsMinor, outgoings);
  const buffer = int('bufferMinor', input.bufferMinor, MAX_TOTAL);
  const known = new Map(knownScenarios(input.income).map((s) => [s.scenario, s.amountMinor]));

  const covered = (balance: number) => (balance < 0 ? Math.floor((buffer * 10) / -balance) / 10 : null);
  const lean = input.income.leanMinor;

  return {
    scenarios: SCENARIOS.map((scenario) => {
      const income = known.get(scenario);
      if (income === undefined) return { scenario, incomeMinor: null, balanceMinor: null, essentialsBalanceMinor: null, goalFundingMinor: null };
      const balance = add(income, -outgoings);
      return {
        scenario,
        incomeMinor: income,
        balanceMinor: balance,
        essentialsBalanceMinor: add(income, -essentials),
        goalFundingMinor: Math.min(toGoals, Math.max(0, balance + toGoals)),
      };
    }),
    breakEvenMinor: outgoings,
    essentialsBreakEvenMinor: essentials,
    leanMonthsCovered: covered(lean - outgoings),
    leanMonthsOfEssentialsCovered: covered(lean - essentials),
  };
}
