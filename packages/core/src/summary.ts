import { toMonthly } from './money';
import type { Item } from './profile';

/** Monthly totals derived from the profile. All amounts are minor units. */
export interface Summary {
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyEssentialExpenses: number;
  monthlyDebtMinimums: number;
  /** Income minus expenses minus minimum debt payments. Negative means a shortfall. */
  monthlySurplus: number;
  totalDebt: number;
  totalSavings: number;
  emergencyFund: number;
  /** Highest APR among debts with a balance, in basis points; null when debt-free. */
  highestAprBps: number | null;
}

export function summarise(items: Item[]): Summary {
  const s: Summary = {
    monthlyIncome: 0,
    monthlyExpenses: 0,
    monthlyEssentialExpenses: 0,
    monthlyDebtMinimums: 0,
    monthlySurplus: 0,
    totalDebt: 0,
    totalSavings: 0,
    emergencyFund: 0,
    highestAprBps: null,
  };
  for (const item of items) {
    switch (item.kind) {
      case 'income':
        s.monthlyIncome += toMonthly(item.amountMinor, item.frequency);
        break;
      case 'expense': {
        const monthly = toMonthly(item.amountMinor, item.frequency);
        s.monthlyExpenses += monthly;
        if (item.essential) s.monthlyEssentialExpenses += monthly;
        break;
      }
      case 'debt':
        s.totalDebt += item.balanceMinor;
        s.monthlyDebtMinimums += item.minimumPaymentMinor;
        if (item.balanceMinor > 0) s.highestAprBps = Math.max(s.highestAprBps ?? 0, item.aprBps);
        break;
      case 'savings':
        s.totalSavings += item.balanceMinor;
        if (item.isEmergencyFund) s.emergencyFund += item.balanceMinor;
        break;
    }
  }
  s.monthlySurplus = s.monthlyIncome - s.monthlyExpenses - s.monthlyDebtMinimums;
  return s;
}
