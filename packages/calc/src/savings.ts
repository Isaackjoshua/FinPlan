import { add, addMonths, int, MAX_MONTHS, MAX_RATE_BPS, monthlyInterest, toMonth } from './util';

export interface EmergencyFundInput {
  /** Monthly spending on essentials only. */
  essentialMonthlyMinor: number;
  /** How many months of essentials the fund should cover. */
  targetMonths: number;
  currentBalanceMinor: number;
  monthlyContributionMinor: number;
  /** First month of contributions, "YYYY-MM" or "YYYY-MM-DD". */
  startDate: string;
}

export interface EmergencyFundResult {
  targetMinor: number;
  /** How much is still needed; 0 once the target is met. */
  gapMinor: number;
  /** Months of essentials the current balance covers, to one decimal place; null if essentials are 0. */
  monthsCovered: number | null;
  /** Contributions needed to close the gap; 0 if already there; null if it is never reached. */
  monthsToTarget: number | null;
  /** Month of the final contribution, "YYYY-MM"; null if already there or never reached. */
  targetReachedMonth: string | null;
}

/** How big an emergency fund should be and how long it takes to fill. Ignores interest, to stay conservative. */
export function calcEmergencyFund(input: EmergencyFundInput): EmergencyFundResult {
  const essentials = int('essentialMonthlyMinor', input.essentialMonthlyMinor);
  const months = int('targetMonths', input.targetMonths, 60);
  const balance = int('currentBalanceMinor', input.currentBalanceMinor);
  const contribution = int('monthlyContributionMinor', input.monthlyContributionMinor);
  const start = toMonth(input.startDate);

  const target = essentials * months;
  const gap = Math.max(0, target - balance);
  const monthsToTarget = gap === 0 ? 0 : contribution === 0 ? null : Math.ceil(gap / contribution);
  return {
    targetMinor: target,
    gapMinor: gap,
    monthsCovered: essentials === 0 ? null : Math.floor((balance * 10) / essentials) / 10,
    monthsToTarget,
    targetReachedMonth: monthsToTarget ? addMonths(start, monthsToTarget - 1) : null,
  };
}

export interface SavingsProjectionInput {
  startingBalanceMinor: number;
  /** Added at the end of each month. */
  monthlyContributionMinor: number;
  annualRateBps: number;
  /** How far to project, up to 600 months. */
  months: number;
  /** Optional amount to watch for. */
  targetMinor?: number;
  /** First month, "YYYY-MM" or "YYYY-MM-DD". */
  startDate: string;
}

export interface SavingsProjectionResult {
  finalBalanceMinor: number;
  totalContributedMinor: number;
  /** Interest earned over the whole period. */
  totalGrowthMinor: number;
  /** Months until the balance first reaches the target; 0 if it starts there; null if not within the period or no target. */
  monthsToTarget: number | null;
  targetReachedMonth: string | null;
  /** Balance at the end of each 12 months, plus the final month if the period is not a whole number of years. */
  series: { month: number; date: string; balanceMinor: number; contributedMinor: number; growthMinor: number }[];
}

/**
 * Projects a savings balance. Each month interest (annual rate / 12) is added to the
 * balance, then the contribution. Assumes a fixed rate and no fees, tax or withdrawals,
 * so it is an illustration, not a forecast.
 */
export function calcSavingsProjection(input: SavingsProjectionInput): SavingsProjectionResult {
  const starting = int('startingBalanceMinor', input.startingBalanceMinor);
  const contribution = int('monthlyContributionMinor', input.monthlyContributionMinor);
  const rate = int('annualRateBps', input.annualRateBps, MAX_RATE_BPS);
  const months = int('months', input.months, MAX_MONTHS);
  const target = input.targetMinor === undefined ? null : int('targetMinor', input.targetMinor);
  const start = toMonth(input.startDate);

  let balance = starting;
  let growth = 0;
  let monthsToTarget: number | null = target !== null && starting >= target ? 0 : null;
  const series: SavingsProjectionResult['series'] = [];

  for (let month = 1; month <= months; month++) {
    const interest = monthlyInterest(balance, rate);
    balance = add(add(balance, interest), contribution);
    growth += interest;
    if (target !== null && monthsToTarget === null && balance >= target) monthsToTarget = month;
    if (month % 12 === 0 || month === months) {
      series.push({
        month,
        date: addMonths(start, month - 1),
        balanceMinor: balance,
        contributedMinor: contribution * month,
        growthMinor: growth,
      });
    }
  }

  return {
    finalBalanceMinor: balance,
    totalContributedMinor: contribution * months,
    totalGrowthMinor: growth,
    monthsToTarget,
    targetReachedMonth: monthsToTarget ? addMonths(start, monthsToTarget - 1) : null,
    series,
  };
}
