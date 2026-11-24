import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addMonthsToDay, calcAllocation, calcCashFlow, CalcError, calcFeasibility, calcSinkingFund, calcTotals, daysInMonth, leanRunShortfall, measureIncome, monthsBetween, occurrences, toDay, worstShortfall,
} from '../src';

const amount = fc.integer({ min: 0, max: 1e9 });

describe('measureIncome', () => {
  it('takes the lowest, the median and the upper quartile', () => {
    expect(measureIncome([])).toBeNull();
    expect(measureIncome([5])).toEqual({ monthsObserved: 1, leanMinor: 5, typicalMinor: 5, goodMinor: 5 });
    // The lesson's six months: lowest 38, between 45 and 52, and fifth of six.
    expect(measureIncome([45, 70, 38, 90, 52, 41])).toEqual({ monthsObserved: 6, leanMinor: 38, typicalMinor: 48, goodMinor: 70 });
    expect(() => measureIncome([1.5])).toThrow(CalcError);
  });
  it('keeps the three in order', () => {
    fc.assert(fc.property(fc.array(amount, { minLength: 1, maxLength: 24 }), (months) => {
      const m = measureIncome(months)!;
      expect(m.leanMinor).toBeLessThanOrEqual(m.typicalMinor);
      expect(m.typicalMinor).toBeLessThanOrEqual(m.goodMinor);
      expect(months).toContain(m.goodMinor);
    }));
  });
});

describe('shortfalls over a run of months', () => {
  it('adds up falling behind until it is caught up, and starts again after a gap', () => {
    expect(worstShortfall([[100, 40, 70, 200, 60]], 100)).toBe(90); // 60 + 30, then caught up
    expect(worstShortfall([[40], [40]], 100)).toBe(60); // unobserved months between: not added together
    expect(worstShortfall([[40, 40]], 100)).toBe(120);
    expect(worstShortfall([[40, 150, 40]], 100)).toBe(70); // only partly caught up in between
    expect(worstShortfall([], 100)).toBe(0);
    expect(() => worstShortfall([[-1]], 100)).toThrow(CalcError);
    expect(() => worstShortfall([Array(1000).fill(0)], 1e13)).toThrow(/too large/);
    expect(() => leanRunShortfall({ leanIncomeMinor: 0, outgoingsMinor: 9e15, months: 2 })).toThrow(/too large/);
  });
  it('sizes a chosen number of lean months', () => {
    expect(leanRunShortfall({ leanIncomeMinor: 200_000, outgoingsMinor: 330_000, months: 3 })).toBe(390_000);
    expect(leanRunShortfall({ leanIncomeMinor: 400, outgoingsMinor: 330, months: 3 })).toBe(0);
  });
});

describe('dates', () => {
  it('rejects what is not a date', () => {
    expect(toDay('2028-02-29')).toBe('2028-02-29');
    for (const bad of ['2026-02-29', '2026-13-01', '26-01-01', '2026-1-1', 'soon', '9999-12-31', '1066-01-01', '+010000-01-01']) expect(() => toDay(bad)).toThrow(CalcError);
  });
  it('adds months without spilling into the next', () => {
    expect(addMonthsToDay('2026-12-31', 2)).toBe('2027-02-28');
    expect(daysInMonth('2028-02')).toBe(29);
    expect(monthsBetween('2026-11-30', '2027-01-01')).toBe(2);
  });
  it('lists when something repeats, keeping the day after a short month', () => {
    expect(occurrences('2026-01-31', { months: 1 }, '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrences('2026-01-01', { months: 3 }, '2026-11-24', '2027-04-30')).toEqual(['2027-01-01', '2027-04-01']);
    expect(occurrences('2020-01-06', { days: 7 }, '2026-11-24', '2026-12-08')).toEqual(['2026-11-30', '2026-12-07']);
    expect(occurrences('2027-06-01', { days: 14 }, '2026-11-24', '2027-06-01')).toEqual(['2027-06-01']);
    expect(occurrences('2027-06-01', { months: 1 }, '2026-11-24', '2027-01-01')).toEqual([]);
  });
});

describe('calcSinkingFund', () => {
  const rent = { amountMinor: 255_000, everyMonths: 3, reservedMinor: 0, today: '2026-11-24' };
  it('gives a steady figure without a date, and a catch-up one with it (grounding case)', () => {
    expect(calcSinkingFund(rent)).toEqual({ steadyMonthlyMinor: 85_000, reservedMinor: 0, remainingMinor: 255_000, dueDate: null, dueDatePassed: false, monthsLeft: null, catchUpMonthlyMinor: null });
    expect(calcSinkingFund({ ...rent, nextDueDate: '2027-01-05' })).toMatchObject({ monthsLeft: 2, catchUpMonthlyMinor: 127_500 });
  });
  it('counts what is already set aside, and leaves at least this month to save in', () => {
    expect(calcSinkingFund({ ...rent, reservedMinor: 100_000, nextDueDate: '2026-11-24' })).toMatchObject({ monthsLeft: 1, remainingMinor: 155_000, catchUpMonthlyMinor: 155_000 });
    expect(calcSinkingFund({ ...rent, reservedMinor: 300_000, nextDueDate: '2027-01-05' })).toMatchObject({ remainingMinor: 0, catchUpMonthlyMinor: 0 });
  });
  it('moves on to the next bill once the date has passed', () => {
    expect(calcSinkingFund({ ...rent, reservedMinor: 255_000, nextDueDate: '2026-05-31' })).toEqual({
      steadyMonthlyMinor: 85_000, reservedMinor: 0, remainingMinor: 255_000, dueDate: '2026-11-30', dueDatePassed: true, monthsLeft: 1, catchUpMonthlyMinor: 255_000,
    });
  });
  it('rounds up, so the money is never short', () => {
    expect(calcSinkingFund({ ...rent, amountMinor: 100, nextDueDate: '2027-02-01' })).toMatchObject({ steadyMonthlyMinor: 34, catchUpMonthlyMinor: 34 });
    expect(() => calcSinkingFund({ ...rent, everyMonths: 0 })).toThrow(/at least 1/);
    // A date from which stepping on never ends is not one at all.
    expect(() => calcSinkingFund({ ...rent, nextDueDate: '9999-10-01', today: '9999-12-31' })).toThrow(/between/);
    expect(calcSinkingFund({ ...rent, reservedMinor: 400_000, nextDueDate: '2026-11-20' })).toMatchObject({ reservedMinor: 145_000, remainingMinor: 110_000, dueDatePassed: true });
  });
});

describe('calcCashFlow', () => {
  const base = { openingMinor: 100, startDate: '2026-11-01', days: 30 };
  it('finds the trough in a month that nets positive', () => {
    const r = calcCashFlow({ ...base, events: [{ id: 'pay', date: '2026-11-28', amountMinor: 500 }, { id: 'rent', date: '2026-11-05', amountMinor: -300 }, { id: 'food', date: '2026-11-10', amountMinor: -50 }] });
    expect(r).toEqual({
      endDate: '2026-11-30', endMinor: 250, moneyInMinor: 500, moneyOutMinor: 350,
      lowest: { date: '2026-11-10', balanceMinor: -250 }, firstShortDate: '2026-11-05',
      points: [
        { date: '2026-11-05', changeMinor: -300, balanceMinor: -200, ids: ['rent'] },
        { date: '2026-11-10', changeMinor: -50, balanceMinor: -250, ids: ['food'] },
        { date: '2026-11-28', changeMinor: 500, balanceMinor: 250, ids: ['pay'] },
      ],
    });
  });
  it('pays a bill before income that lands the same day, and ignores other days', () => {
    const r = calcCashFlow({ ...base, events: [{ id: 'a', date: '2026-11-03', amountMinor: 500 }, { id: 'b', date: '2026-11-03', amountMinor: -200 }, { id: 'c', date: '2026-12-01', amountMinor: -999 }, { id: 'd', date: '2026-10-31', amountMinor: -999 }] });
    expect(r).toMatchObject({ lowest: { date: '2026-11-03', balanceMinor: -100 }, firstShortDate: '2026-11-03', endMinor: 400 });
    expect(calcCashFlow({ ...base, events: [] })).toMatchObject({ lowest: { date: '2026-11-01', balanceMinor: 100 }, firstShortDate: null, points: [] });
  });
  it('rejects unusable input', () => {
    expect(() => calcCashFlow({ ...base, days: 0, events: [] })).toThrow(/at least 1/);
    expect(() => calcCashFlow({ ...base, events: {} as never })).toThrow(CalcError);
    expect(() => calcCashFlow({ ...base, events: [{ id: 'x', date: '2026-11-03', amountMinor: 0.5 }] })).toThrow(CalcError);
  });
});

describe('calcAllocation', () => {
  it('fills each step in order, up to its cap', () => {
    expect(calcAllocation({ availableMinor: 100, steps: [{ id: 'a', needMinor: 30 }, { id: 'b', needMinor: 500, capMinor: 40 }, { id: 'c', needMinor: 50, capMinor: null }, { id: 'd', needMinor: 5 }] })).toEqual({
      availableMinor: 100,
      lines: [
        { id: 'a', wantedMinor: 30, allocatedMinor: 30, unmetMinor: 0 },
        { id: 'b', wantedMinor: 40, allocatedMinor: 40, unmetMinor: 0 },
        { id: 'c', wantedMinor: 50, allocatedMinor: 30, unmetMinor: 20 },
        { id: 'd', wantedMinor: 5, allocatedMinor: 0, unmetMinor: 5 },
      ],
      allocatedMinor: 100, leftMinor: 0, firstUnmetId: 'c',
    });
    expect(calcAllocation({ availableMinor: 7, steps: [] })).toMatchObject({ leftMinor: 7, firstUnmetId: null });
  });
  it('rejects repeated or missing ids, and lists that are too long', () => {
    const step = { id: 'a', needMinor: 1 };
    expect(() => calcAllocation({ availableMinor: 1, steps: [step, step] })).toThrow(/unique/);
    expect(() => calcAllocation({ availableMinor: 1, steps: [{ ...step, id: '' }] })).toThrow(/unique/);
    expect(() => calcAllocation({ availableMinor: 1, steps: [{ ...step, id: 1 as never }] })).toThrow(/unique/);
    expect(() => calcAllocation({ availableMinor: 1, steps: Array(10_001).fill(step) })).toThrow(/at most/);
    expect(() => calcAllocation({ availableMinor: 1, steps: null as never })).toThrow(/at most/);
  });
  it('always shares out exactly what there is, and nothing before its turn', () => {
    fc.assert(fc.property(amount, fc.array(fc.tuple(amount, fc.option(amount)), { maxLength: 20 }), (availableMinor, raw) => {
      const r = calcAllocation({ availableMinor, steps: raw.map(([needMinor, capMinor], i) => ({ id: `s${i}`, needMinor, capMinor })) });
      expect(r.lines.reduce((sum, l) => sum + l.allocatedMinor, 0) + r.leftMinor).toBe(availableMinor);
      const stop = r.lines.findIndex((l) => l.unmetMinor > 0);
      if (stop >= 0) expect(r.lines.slice(stop + 1).every((l) => l.allocatedMinor === 0)).toBe(true);
      if (r.leftMinor > 0) expect(stop).toBe(-1);
    }));
  });
});

describe('calcTotals', () => {
  it('adds up amounts at different intervals, by group (grounding case)', () => {
    const month = (id: string, amountMinor: number, group?: string) => ({ id, amountMinor, timesPerYear: 12, group });
    const r = calcTotals({ lines: [{ id: 'rent', amountMinor: 255_000, timesPerYear: 4, group: 'home' }, month('food', 160_000), month('claude', 66_000), month('gym', 60_000), month('transport', 55_000), month('power', 20_000, 'home'), month('data', 17_500), month('water', 10_000, 'home')] });
    expect(r.monthlyMinor).toBe(473_500);
    expect(r.yearlyMinor).toBe(473_500 * 12);
    expect(r.lines[0]).toEqual({ id: 'rent', amountMinor: 255_000, monthlyMinor: 85_000, yearlyMinor: 1_020_000 });
    expect(r.groups).toEqual([{ group: 'home', monthlyMinor: 115_000, yearlyMinor: 1_380_000 }]);
    expect(() => calcTotals({ lines: null as never })).toThrow(/at most/);
  });
});

describe('calcFeasibility', () => {
  const base = { remainingMinor: 2_541_000, targetDate: '2027-01-31', today: '2026-11-24', leftOver: { leanMinor: -273_500, typicalMinor: null, goodMinor: null } };
  it('finds a dated goal out of reach of a shortfall (grounding case)', () => {
    expect(calcFeasibility(base)).toEqual({
      monthsLeft: 2, requiredMonthlyMinor: 1_270_500, verdict: 'unreachable',
      scenarios: [{ scenario: 'lean', enough: false }, { scenario: 'typical', enough: null }, { scenario: 'good', enough: null }],
    });
  });
  it('tells reachable from reachable in better months only', () => {
    const verdict = (over: object) => calcFeasibility({ ...base, remainingMinor: 200, ...over }).verdict;
    expect(verdict({ leftOver: { leanMinor: 100, typicalMinor: 100, goodMinor: 100 } })).toBe('reachable');
    expect(verdict({ leftOver: { leanMinor: 99, typicalMinor: null, goodMinor: 100 } })).toBe('some_months_only');
    expect(verdict({ targetDate: '2026-11-23' })).toBe('date_passed');
    expect(verdict({ targetDate: '1066-01-01' })).toBe('date_passed');
    expect(calcFeasibility({ ...base, targetDate: '9999-12-31' }).monthsLeft).toBe(monthsBetween('2026-11-24', '2200-12-31'));
    expect(verdict({ targetDate: null })).toBe('no_date');
    expect(verdict({ remainingMinor: 0 })).toBe('reached');
  });
});
