import type { Item } from './profile';
import { summarise, type Summary } from './summary';

export interface Warning {
  /** Stable identifier, e.g. "spending_exceeds_income". Agents and tests key off this. */
  code: string;
  severity: 'info' | 'warn';
  /** Shown to the user on the dashboard, and later returned to agents after a write. */
  message: string;
}

/**
 * Flags things in a profile that look wrong or risky, so the user (and later their
 * agent) notices before building a plan on top of them.
 *
 * All amounts in `summary` are monthly figures or balances in minor units; compare
 * them as ratios rather than against fixed amounts, since the currency varies.
 */
export function profileWarnings(summary: Summary): Warning[] {
  const warnings: Warning[] = [];
  const hasAnything =
    summary.monthlyExpenses > 0 || summary.totalDebt > 0 || summary.totalSavings > 0;

  if (summary.monthlyIncome === 0) {
    // Almost always an unfinished profile rather than a real situation, and every
    // ratio below would be meaningless, so say that and stop.
    if (hasAnything) {
      warnings.push({
        code: 'no_income_recorded',
        severity: 'info',
        message: 'No income is recorded yet, so the figures here are incomplete.',
      });
    }
    return warnings;
  }

  if (summary.monthlySurplus < 0) {
    warnings.push({
      code: 'spending_exceeds_income',
      severity: 'warn',
      message: 'Your expenses and minimum debt payments add up to more than your income.',
    });
  }

  // 36% of take-home pay is a common upper bound lenders use for total debt payments.
  if (summary.monthlyDebtMinimums * 100 > summary.monthlyIncome * 36) {
    warnings.push({
      code: 'high_debt_payments',
      severity: 'warn',
      message: 'More than a third of your income goes to minimum debt payments.',
    });
  }

  if (summary.monthlyEssentialExpenses > 0 && summary.emergencyFund < summary.monthlyEssentialExpenses) {
    warnings.push({
      code: 'low_emergency_fund',
      severity: 'warn',
      message: 'Your emergency fund covers less than one month of essential expenses.',
    });
  }

  if (summary.highestAprBps !== null && summary.highestAprBps >= 2000) {
    warnings.push({
      code: 'high_interest_debt',
      severity: 'info',
      message: 'You have debt charging 20% a year or more. Paying it down first usually saves the most.',
    });
  }

  return warnings;
}

/** Checks on whether the profile is complete. The user can tell FinPlan that one is right for them. */
export const COMPLETENESS_CODES = ['no_housing_recorded', 'no_food_recorded', 'expenses_look_low', 'surplus_unreliable'] as const;
export type CompletenessCode = (typeof COMPLETENESS_CODES)[number];

/** Fewer expense lines than this is too little to base a surplus on. */
const FEW_EXPENSES = 3;
/** Spending below this share of income is more often unrecorded than frugal. */
const LOW_SPENDING_PERCENT = 30;

export interface ProfileCheck {
  summary: Summary;
  warnings: Warning[];
  /** False when the figures leave money over only because the profile looks unfinished. */
  surplusReliable: boolean;
  /** Checks that would have been raised, had the user not said they are right. */
  acknowledged: CompletenessCode[];
}

/**
 * Totals a profile and flags what is wrong, risky or missing in it. Use this rather than
 * `summarise` wherever the totals are shown: a surplus from a half-filled profile misleads.
 */
export function checkProfile(items: Item[], acknowledgedCodes: readonly string[] = []): ProfileCheck {
  const summary = summarise(items);
  const missing: Warning[] = [];
  const acknowledged: CompletenessCode[] = [];
  const raise = (code: CompletenessCode, message: string) => {
    if (acknowledgedCodes.includes(code)) acknowledged.push(code);
    else missing.push({ code, severity: 'warn', message });
  };

  // With no income there is no surplus to doubt, and profileWarnings already says the profile is unfinished.
  if (summary.monthlyIncome > 0) {
    const expenses = items.filter((item) => item.kind === 'expense' && item.amountMinor > 0);
    const spendsOn = (category: string) => expenses.some((item) => item.kind === 'expense' && item.category === category);
    const hasMortgage = items.some((item) => item.kind === 'debt' && item.debtKind === 'mortgage' && item.balanceMinor > 0);

    if (!spendsOn('housing') && !hasMortgage) raise('no_housing_recorded', 'No housing cost is recorded, such as rent.');
    if (!spendsOn('food')) raise('no_food_recorded', 'No spending on food is recorded.');
    if ((summary.monthlyExpenses + summary.monthlyDebtMinimums) * 100 < summary.monthlyIncome * LOW_SPENDING_PERCENT) {
      raise('expenses_look_low', 'Recorded spending is very low compared with income, so some of it may be missing.');
    }
    if (summary.monthlySurplus > 0) {
      const message = 'The money left over each month cannot be relied on yet, because spending looks incomplete. Do not plan on it until the profile is filled in.';
      // Saying "that is everything" settles a short list. It does not settle a check that is still open.
      if (missing.length > 0) missing.push({ code: 'surplus_unreliable', severity: 'warn', message });
      else if (expenses.length < FEW_EXPENSES) raise('surplus_unreliable', message);
    }
  }

  return {
    summary,
    warnings: [...missing, ...profileWarnings(summary)],
    surplusReliable: !missing.some((w) => w.code === 'surplus_unreliable'),
    acknowledged,
  };
}
