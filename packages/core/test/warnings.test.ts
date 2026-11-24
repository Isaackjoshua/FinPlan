import { describe, expect, it } from 'vitest';
import { checkProfile, profileWarnings, summarise, type Item, type Summary } from '../src';
import { data, debt, food, groundingItems, income, incompleteItems, rent, savings, tzs } from './grounding';

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

describe('checkProfile', () => {
  const raised = (items: Item[], acknowledged: string[] = []) => checkProfile(items, acknowledged).warnings.map((w) => w.code);

  it('does not trust a surplus from a profile without housing or food', () => {
    const check = checkProfile(incompleteItems);
    expect(check.summary.monthlySurplus).toBe(tzs(116_500)); // the confident figure that misled people
    expect(check.surplusReliable).toBe(false);
    expect(check.warnings.map((w) => w.code)).toEqual(['no_housing_recorded', 'no_food_recorded', 'surplus_unreliable']);
    // Figures come from fields, never from the wording.
    expect(check.warnings.every((w) => !/\d/.test(w.message))).toBe(true);
  });

  it('does not trust income with nothing else recorded', () => {
    expect(raised([income])).toEqual(['no_housing_recorded', 'no_food_recorded', 'expenses_look_low', 'surplus_unreliable']);
  });

  it('raises no completeness check on the full profile, whose shortfall is real', () => {
    const check = checkProfile(groundingItems);
    expect(check.summary).toMatchObject({ monthlyExpenses: tzs(473_500), monthlySurplus: tzs(-273_500) });
    expect(check.surplusReliable).toBe(true);
    expect(check.warnings.map((w) => w.code)).toEqual(['spending_exceeds_income', 'low_emergency_fund']);
  });

  it('says what is missing even when the profile already shows a shortfall', () => {
    const check = checkProfile(groundingItems.filter((i) => i !== rent));
    expect(check.warnings.map((w) => w.code)).toEqual(['no_housing_recorded', 'spending_exceeds_income']);
    expect(check.surplusReliable).toBe(true); // no surplus is being claimed
  });

  it('says nothing about an empty profile or one without income', () => {
    expect(raised([])).toEqual([]);
    expect(raised([food])).toEqual(['no_income_recorded']);
  });

  it('counts a mortgage as housing, but not one that is paid off', () => {
    const mortgage: Item = { id: 'm', kind: 'debt', label: 'Home', debtKind: 'mortgage', balanceMinor: tzs(900_000), aprBps: 900, minimumPaymentMinor: tzs(40_000) };
    expect(raised([income, food, mortgage])).not.toContain('no_housing_recorded');
    expect(raised([income, food, { ...mortgage, balanceMinor: 0 }])).toContain('no_housing_recorded');
  });

  it('ignores expenses of zero', () => {
    expect(raised([income, rent, { ...food, amountMinor: 0 } as Item])).toContain('no_food_recorded');
  });

  it('flags spending under 30% of income, counting debt payments, but not at 30%', () => {
    const spend = (amountMinor: number, minimumPaymentMinor = 0): Item[] => [
      { ...income, amountMinor: 100_000 } as Item,
      { ...food, amountMinor } as Item,
      { ...debt, minimumPaymentMinor } as Item,
    ];
    expect(raised(spend(29_999))).toContain('expenses_look_low');
    expect(raised(spend(30_000))).not.toContain('expenses_look_low');
    expect(raised(spend(29_999, 1))).not.toContain('expenses_look_low');
  });

  it('wants three expense lines before it trusts a surplus', () => {
    const rich = { ...income, amountMinor: tzs(300_000) } as Item;
    expect(raised([rich, rent, food, savings])).toEqual(['surplus_unreliable']);
    expect(raised([rich, rent, food, data, savings])).toEqual([]);
  });

  it('drops a check the user has answered, and keeps the rest', () => {
    const check = checkProfile(incompleteItems, ['no_housing_recorded', 'surplus_unreliable']);
    expect(check.warnings.map((w) => w.code)).toEqual(['no_food_recorded', 'surplus_unreliable']); // food is still open
    expect(check.acknowledged).toEqual(['no_housing_recorded']);
    const settled = checkProfile(incompleteItems, ['no_housing_recorded', 'no_food_recorded', 'surplus_unreliable']);
    expect(settled).toMatchObject({ warnings: [], surplusReliable: true });
    expect(settled.acknowledged).toHaveLength(3);
    // An answer to a check that would not fire anyway is not reported.
    expect(checkProfile(groundingItems, ['no_food_recorded']).acknowledged).toEqual([]);
  });

  it('only lets completeness checks be answered', () => {
    expect(raised(groundingItems, ['spending_exceeds_income', 'low_emergency_fund'])).toEqual(['spending_exceeds_income', 'low_emergency_fund']);
  });

  it('leaves the totals as they were', () => {
    expect(checkProfile(groundingItems).summary).toEqual(summarise(groundingItems));
  });
});

describe('summarise', () => {
  it('stops counting the minimum payment of a debt that is cleared', () => {
    const cleared = { ...debt, balanceMinor: 0, minimumPaymentMinor: tzs(5_000) } as Item;
    const live = { ...debt, id: 'live', minimumPaymentMinor: tzs(2_000) } as Item;
    expect(summarise([income, cleared, live])).toMatchObject({ monthlyDebtMinimums: tzs(2_000), monthlySurplus: tzs(198_000) });
  });
});
