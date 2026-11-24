import { addDays, toDay } from './dates';
import { add, CalcError, int, MAX_TOTAL } from './util';

export interface CashEvent {
  id: string;
  date: string;
  /** Positive for money in, negative for money out. */
  amountMinor: number;
}

export interface CashFlowInput {
  /** Money that can be spent on the first day. */
  openingMinor: number;
  startDate: string;
  days: number;
  events: CashEvent[];
}

export interface CashFlowResult {
  endDate: string;
  endMinor: number;
  moneyInMinor: number;
  moneyOutMinor: number;
  /** The lowest point and the first day it is reached. The opening balance counts. */
  lowest: { date: string; balanceMinor: number };
  /** The first day there is not enough; null if there always is. */
  firstShortDate: string | null;
  /** The balance after each day on which something happens. */
  points: { date: string; changeMinor: number; balanceMinor: number; ids: string[] }[];
}

/**
 * Runs a balance forward day by day. On a day with money both in and out, the money out goes
 * first: it is not safe to assume income lands before the bill.
 */
export function calcCashFlow(input: CashFlowInput): CashFlowResult {
  const opening = int('openingMinor', input.openingMinor);
  const start = toDay(input.startDate);
  const days = int('days', input.days, 366);
  if (days === 0) throw new CalcError('invalid_input', 'days must be at least 1');
  if (!Array.isArray(input.events) || input.events.length > 100_000) throw new CalcError('invalid_input', 'events must be a list of at most 100000 items');
  const end = addDays(start, days - 1);

  const byDay = new Map<string, CashEvent[]>();
  for (const [i, event] of input.events.entries()) {
    const date = toDay(event.date);
    int(`events[${i}].amountMinor`, Math.abs(event.amountMinor), MAX_TOTAL);
    if (date >= start && date <= end) byDay.set(date, [...(byDay.get(date) ?? []), event]);
  }

  let balance = opening;
  let moneyIn = 0;
  let moneyOut = 0;
  let lowest = { date: start, balanceMinor: opening };
  let firstShortDate: string | null = null;
  const points: CashFlowResult['points'] = [];
  for (const date of [...byDay.keys()].sort()) {
    const events = byDay.get(date)!;
    const out = events.reduce((sum, e) => sum + Math.max(0, -e.amountMinor), 0);
    const inn = events.reduce((sum, e) => sum + Math.max(0, e.amountMinor), 0);
    const afterBills = add(balance, -out);
    if (afterBills < lowest.balanceMinor) lowest = { date, balanceMinor: afterBills };
    if (afterBills < 0 && firstShortDate === null) firstShortDate = date;
    balance = add(afterBills, inn);
    moneyIn = add(moneyIn, inn);
    moneyOut = add(moneyOut, out);
    points.push({ date, changeMinor: inn - out, balanceMinor: balance, ids: events.map((e) => e.id) });
  }
  return { endDate: end, endMinor: balance, moneyInMinor: moneyIn, moneyOutMinor: moneyOut, lowest, firstShortDate, points };
}
