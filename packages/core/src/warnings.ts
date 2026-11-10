import type { Summary } from './summary';

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
