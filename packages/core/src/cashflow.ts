import { addDays, calcCashFlow, CalcError, occurrences, toDay, type CashEvent, type CashFlowResult, type ScenarioName } from '@fin/calc';
import type { IncomeBand } from './income';
import { INTERVAL, lumpyMonths, toMonthly } from './money';
import type { Item } from './profile';
import type { IncomeReceipt } from './receipts';

export interface CashFlowOptions {
  openingMinor: number;
  startDate: string;
  days: number;
  scenario: ScenarioName;
  band: IncomeBand;
  /** When the opening amount was right, to tell which receipts are already in it. */
  openingAsOf: { date: string; recordedAt: string };
  /** Receipts in the month of `startDate`. Those already in the opening amount are not expected again. */
  receipts?: Pick<IncomeReceipt, 'receivedOn' | 'amountMinor' | 'itemId' | 'loggedAt'>[];
}

export interface CashFlow extends CashFlowResult {
  scenario: ScenarioName;
  startDate: string;
  openingMinor: number;
  /** Income, expenses and debts left out because no date is recorded for them. */
  undated: { id: string; kind: 'income' | 'expense' | 'debt' }[];
  /** Big bills whose date has passed without being marked paid. They are taken as paid, and may not be. */
  assumedPaid: { id: string; date: string }[];
  /** Money received that is not linked to one of several incomes, so it is not known which not to expect again. */
  unmatchedReceiptsMinor: number;
  /** True when something had to be left out or assumed. */
  partial: boolean;
}

/**
 * Runs the profile forward day by day. Income that comes between two days of the month is taken
 * to come on the last of them. Nothing is guessed: what has no date is listed, not placed.
 */
export function cashFlow(items: Item[], options: CashFlowOptions): CashFlow {
  const start = toDay(options.startDate);
  const end = addDays(start, options.days - 1);
  const month = start.slice(0, 7);
  const events: CashEvent[] = [];
  const undated: CashFlow['undated'] = [];

  const assumedPaid: CashFlow['assumedPaid'] = [];

  const target = { lean: options.band.leanMinor, typical: options.band.typicalMinor, good: options.band.goodMinor }[options.scenario];
  if (target === null) throw new CalcError('invalid_input', `What a ${options.scenario} month brings in is not known, so only a lean month can be worked out`);
  const sources = items.filter((item) => item.kind === 'income');
  const expectedFrom = new Map(
    sources.map((item) => {
      const varying = item.variability === 'variable' && options.scenario !== 'lean';
      const said = varying ? (options.scenario === 'typical' ? item.typicalMinor : item.highMinor) : item.amountMinor;
      return [item.id, said ?? item.amountMinor];
    }),
  );
  // The band may rest on measured months. What it differs by from the sources falls on varying income.
  let differs = target - sources.reduce((sum, item) => sum + toMonthly(expectedFrom.get(item.id)!, item.frequency), 0);
  for (const item of sources.filter((i) => i.variability === 'variable')) {
    const now = expectedFrom.get(item.id)!;
    const change = Math.max(-now, differs);
    expectedFrom.set(item.id, now + change);
    differs -= change;
  }

  const { date: asOf, recordedAt } = options.openingAsOf;
  const receipts = (options.receipts ?? []).filter(
    (r) => r.receivedOn.slice(0, 7) === month && (r.receivedOn < asOf || (r.receivedOn === asOf && r.loggedAt.toISOString() <= recordedAt)),
  );
  const sumOf = (list: typeof receipts) => list.reduce((sum, r) => sum + r.amountMinor, 0);
  const loose = sumOf(receipts.filter((r) => !sources.some((item) => item.id === r.itemId)));
  // With one income there is no doubt which it was.
  const receivedFor = (id: string) => sumOf(receipts.filter((r) => r.itemId === id)) + (sources.length === 1 ? loose : 0);
  const unmatchedReceiptsMinor = sources.length > 1 ? loose : 0;

  for (const item of items) {
    if (item.kind === 'income') {
      const amount = expectedFrom.get(item.id)!;
      const dates = item.arrival
        ? occurrences(`2000-01-${String(item.arrival.toDay).padStart(2, '0')}`, { months: 1 }, start, end)
        : item.nextPayDate
          ? occurrences(item.nextPayDate, INTERVAL[item.frequency], start, end)
          : null;
      if (dates === null) {
        if (amount > 0) undated.push({ id: item.id, kind: 'income' });
        continue;
      }
      for (const date of dates) {
        // Only a month's one payment can be told apart from the next, so only monthly income is reduced.
        const expected = item.frequency === 'monthly' && date.slice(0, 7) === month ? Math.max(0, amount - receivedFor(item.id)) : amount;
        if (expected > 0) events.push({ id: item.id, date, amountMinor: expected });
      }
    } else if (item.kind === 'expense' && item.amountMinor > 0) {
      if (!item.nextDueDate) {
        undated.push({ id: item.id, kind: 'expense' });
        continue;
      }
      if (item.nextDueDate < start && lumpyMonths(item.frequency) !== null) assumedPaid.push({ id: item.id, date: item.nextDueDate });
      for (const date of occurrences(item.nextDueDate, INTERVAL[item.frequency], start, end)) events.push({ id: item.id, date, amountMinor: -item.amountMinor });
    } else if (item.kind === 'debt' && item.balanceMinor > 0 && item.minimumPaymentMinor > 0) {
      if (!item.nextDueDate) {
        undated.push({ id: item.id, kind: 'debt' });
        continue;
      }
      // Without interest it is certain when the debt ends; with it, payments are taken to go on.
      let owed = item.aprBps === 0 ? item.balanceMinor : Infinity;
      for (const date of occurrences(item.nextDueDate, INTERVAL.monthly, start, end)) {
        const payment = Math.min(item.minimumPaymentMinor, owed);
        owed -= payment;
        if (payment > 0) events.push({ id: item.id, date, amountMinor: -payment });
      }
    }
  }
  return {
    scenario: options.scenario,
    startDate: start,
    openingMinor: options.openingMinor,
    undated,
    assumedPaid,
    unmatchedReceiptsMinor,
    partial: undated.length > 0 || assumedPaid.length > 0 || unmatchedReceiptsMinor > 0,
    ...calcCashFlow({ openingMinor: options.openingMinor, startDate: start, days: options.days, events }),
  };
}
