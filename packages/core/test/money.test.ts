import { describe, expect, it } from 'vitest';
import { formatAmount, isSupportedCurrency, minorDigits, parseAmount, summarise, toDecimalString, toMonthly, type Item } from '../src';

describe('money', () => {
  it('knows how many decimals each currency has', () => {
    expect(minorDigits('USD')).toBe(2);
    expect(minorDigits('KES')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
    expect(minorDigits('KWD')).toBe(3);
  });

  it('parses typed amounts into minor units', () => {
    expect(parseAmount('1,250.50', 'USD')).toBe(125050);
    expect(parseAmount('1250.5', 'USD')).toBe(125050);
    expect(parseAmount('1250', 'JPY')).toBe(1250);
    expect(parseAmount('1.050', 'KWD')).toBe(1050);
    expect(parseAmount('0.1', 'USD')).toBe(10);
  });

  it('rejects things that are not amounts', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1e5', '1.2.3']) expect(parseAmount(bad, 'USD')).toBeNull();
    expect(parseAmount('10.5', 'JPY')).toBeNull();
  });

  it('formats and round-trips', () => {
    expect(formatAmount(125050, 'USD')).toBe('$1,250.50');
    expect(toDecimalString(125050, 'USD')).toBe('1250.50');
    expect(parseAmount(toDecimalString(999, 'KWD'), 'KWD')).toBe(999);
  });

  it('checks currency codes', () => {
    expect(isSupportedCurrency('EUR')).toBe(true);
    expect(isSupportedCurrency('eur')).toBe(false);
    expect(isSupportedCurrency('ZZZ')).toBe(false);
  });

  it('converts frequencies to monthly', () => {
    expect(toMonthly(30000, 'monthly')).toBe(30000);
    expect(toMonthly(120000, 'yearly')).toBe(10000);
    expect(toMonthly(10000, 'weekly')).toBe(43333);
    expect(toMonthly(10000, 'fortnightly')).toBe(21667);
    expect(toMonthly(30000, 'quarterly')).toBe(10000);
  });
});

describe('summarise', () => {
  it('totals a profile', () => {
    const items: Item[] = [
      { id: '1', kind: 'income', label: 'Salary', amountMinor: 500000, frequency: 'monthly' },
      { id: '2', kind: 'income', label: 'Bonus', amountMinor: 120000, frequency: 'yearly' },
      { id: '3', kind: 'expense', label: 'Rent', amountMinor: 150000, frequency: 'monthly', category: 'housing', essential: true },
      { id: '4', kind: 'expense', label: 'Films', amountMinor: 5000, frequency: 'monthly', category: 'entertainment', essential: false },
      { id: '5', kind: 'debt', label: 'Card', debtKind: 'credit_card', balanceMinor: 200000, aprBps: 2400, minimumPaymentMinor: 6000 },
      { id: '6', kind: 'debt', label: 'Paid off', debtKind: 'other', balanceMinor: 0, aprBps: 9900, minimumPaymentMinor: 0 },
      { id: '7', kind: 'savings', label: 'Buffer', balanceMinor: 80000, apyBps: 300, isEmergencyFund: true },
      { id: '8', kind: 'savings', label: 'Holiday', balanceMinor: 20000, apyBps: 0, isEmergencyFund: false },
    ];
    expect(summarise(items)).toEqual({
      monthlyIncome: 510000,
      monthlyExpenses: 155000,
      monthlyEssentialExpenses: 150000,
      monthlyDebtMinimums: 6000,
      monthlySurplus: 349000,
      totalDebt: 200000,
      totalSavings: 100000,
      emergencyFund: 80000,
      highestAprBps: 2400,
    });
  });

  it('handles an empty profile', () => {
    expect(summarise([])).toMatchObject({ monthlySurplus: 0, highestAprBps: null });
  });
});
