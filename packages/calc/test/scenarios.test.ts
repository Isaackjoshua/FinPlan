import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calcScenarios, CalcError, checkBand, knownScenarios, type ScenariosInput } from '../src';

const input = (over: Partial<ScenariosInput> = {}): ScenariosInput => ({
  income: { leanMinor: 200_000, typicalMinor: null, goodMinor: null },
  outgoingsMinor: 473_500,
  essentialOutgoingsMinor: 330_000,
  goalContributionsMinor: 0,
  bufferMinor: 300_000,
  ...over,
});

describe('calcScenarios', () => {
  it('states a lean month and leaves the others unknown (grounding case)', () => {
    const unknown = { incomeMinor: null, balanceMinor: null, essentialsBalanceMinor: null, goalFundingMinor: null };
    expect(calcScenarios(input())).toEqual({
      scenarios: [
        { scenario: 'lean', incomeMinor: 200_000, balanceMinor: -273_500, essentialsBalanceMinor: -130_000, goalFundingMinor: 0 },
        { scenario: 'typical', ...unknown },
        { scenario: 'good', ...unknown },
      ],
      breakEvenMinor: 473_500,
      essentialsBreakEvenMinor: 330_000,
      leanMonthsCovered: 1, // 300,000 / 273,500
      leanMonthsOfEssentialsCovered: 2.3, // 300,000 / 130,000
    });
  });

  it('funds goals only with what is left after everything else', () => {
    const r = calcScenarios(input({ income: { leanMinor: 400_000, typicalMinor: 460_000, goodMinor: 900_000 }, outgoingsMinor: 480_000, goalContributionsMinor: 50_000 }));
    // 430,000 goes out before goals: a lean month has nothing for them, a typical one 30,000, a good one all of it.
    expect(r.scenarios.map((s) => [s.balanceMinor, s.goalFundingMinor])).toEqual([[-80_000, 0], [-20_000, 30_000], [420_000, 50_000]]);
  });

  it('has no runway to state when a lean month balances', () => {
    expect(calcScenarios(input({ income: { leanMinor: 473_500, typicalMinor: null, goodMinor: null } }))).toMatchObject({ leanMonthsCovered: null, leanMonthsOfEssentialsCovered: null });
  });

  it('allows a lean month of nothing, and a good month known without a typical one', () => {
    expect(calcScenarios(input({ income: { leanMinor: 0, typicalMinor: null, goodMinor: 500_000 } })).scenarios.map((s) => s.balanceMinor)).toEqual([-473_500, null, 26_500]);
  });

  it('rejects months out of order, and goal money beyond the outgoings', () => {
    expect(() => checkBand({ leanMinor: 5, typicalMinor: 4, goodMinor: null })).toThrow(CalcError);
    expect(() => checkBand({ leanMinor: 5, typicalMinor: 6, goodMinor: 5 })).toThrow(CalcError);
    expect(() => checkBand({ leanMinor: 5, typicalMinor: null, goodMinor: 4 })).toThrow(CalcError);
    expect(() => checkBand({ leanMinor: 1.5, typicalMinor: null, goodMinor: null })).toThrow(CalcError);
    expect(() => calcScenarios(input({ goalContributionsMinor: 473_501 }))).toThrow(CalcError);
    expect(knownScenarios({ leanMinor: 5, typicalMinor: 5, goodMinor: null })).toEqual([{ scenario: 'lean', amountMinor: 5 }, { scenario: 'typical', amountMinor: 5 }]);
  });

  it('never does worse in a better month, and goals never get more than was planned', () => {
    const amount = fc.integer({ min: 0, max: 1e12 });
    fc.assert(
      fc.property(fc.tuple(amount, amount, amount), amount, amount, amount, (incomes, spending, toGoals, bufferMinor) => {
        const [leanMinor, typicalMinor, goodMinor] = [...incomes].sort((a, b) => a - b) as [number, number, number];
        const outgoingsMinor = spending + toGoals;
        const { scenarios } = calcScenarios({ income: { leanMinor, typicalMinor, goodMinor }, outgoingsMinor, essentialOutgoingsMinor: spending, goalContributionsMinor: toGoals, bufferMinor });
        for (const [i, s] of scenarios.entries()) {
          expect(s.balanceMinor).toBe(s.incomeMinor! - outgoingsMinor);
          expect(s.goalFundingMinor).toBeGreaterThanOrEqual(0);
          expect(s.goalFundingMinor).toBeLessThanOrEqual(toGoals);
          if (i > 0) expect(s.goalFundingMinor!).toBeGreaterThanOrEqual(scenarios[i - 1]!.goalFundingMinor!);
        }
      }),
    );
  });
});
