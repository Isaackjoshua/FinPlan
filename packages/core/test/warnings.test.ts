import { describe, expect, it } from 'vitest';
import { profileWarnings, type Summary } from '../src';

const healthy: Summary = {
  monthlyIncome: 100_000,
  monthlyExpenses: 50_000,
  monthlyEssentialExpenses: 40_000,
  monthlyDebtMinimums: 10_000,
  monthlySurplus: 40_000,
  totalDebt: 200_000,
  totalSavings: 150_000,
  emergencyFund: 120_000,
  highestAprBps: 900,
};
const codes = (s: Partial<Summary>) => profileWarnings({ ...healthy, ...s }).map((w) => w.code);

describe('profileWarnings', () => {
  it('says nothing about a healthy or empty profile', () => {
    expect(codes({})).toEqual([]);
    expect(codes({ monthlyIncome: 0, monthlyExpenses: 0, totalDebt: 0, totalSavings: 0 })).toEqual([]);
  });

  it('treats missing income as an unfinished profile and stops there', () => {
    expect(codes({ monthlyIncome: 0, monthlySurplus: -60_000 })).toEqual(['no_income_recorded']);
    expect(codes({ monthlyIncome: 0, monthlyExpenses: 0, totalDebt: 0 })).toEqual(['no_income_recorded']);
    expect(codes({ monthlyIncome: 0, monthlyExpenses: 0, totalSavings: 0 })).toEqual(['no_income_recorded']);
  });

  it('flags spending above income', () => {
    expect(codes({ monthlySurplus: -1 })).toEqual(['spending_exceeds_income']);
  });

  it('flags debt payments above 36% of income, but not at 36%', () => {
    expect(codes({ monthlyDebtMinimums: 36_000 })).toEqual([]);
    expect(codes({ monthlyDebtMinimums: 36_001 })).toEqual(['high_debt_payments']);
  });

  it('flags an emergency fund under one month of essentials', () => {
    expect(codes({ emergencyFund: 39_999 })).toEqual(['low_emergency_fund']);
    expect(codes({ emergencyFund: 40_000 })).toEqual([]);
    expect(codes({ emergencyFund: 0, monthlyEssentialExpenses: 0 })).toEqual([]);
  });

  it('notes debt at 20% or more, and ignores being debt-free', () => {
    expect(codes({ highestAprBps: 2000 })).toEqual(['high_interest_debt']);
    expect(codes({ highestAprBps: 1999 })).toEqual([]);
    expect(codes({ highestAprBps: null })).toEqual([]);
  });

  it('can raise several at once', () => {
    expect(codes({ monthlySurplus: -5, monthlyDebtMinimums: 50_000, emergencyFund: 0, highestAprBps: 3600 })).toHaveLength(4);
  });
});
