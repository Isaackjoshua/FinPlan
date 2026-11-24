import { addMonthsToDay, monthsBetween, toDay } from './dates';
import { CalcError, int, MAX_TOTAL } from './util';

export interface SinkingFundInput {
  /** The bill. */
  amountMinor: number;
  /** How many months from one bill to the next. */
  everyMonths: number;
  /** Already set aside for the next one. */
  reservedMinor: number;
  /** When the next one is due, if known. */
  nextDueDate?: string | null;
  today: string;
}

export interface SinkingFundResult {
  /** What to set aside every month to always be ready. */
  steadyMonthlyMinor: number;
  /** What there is towards the next bill, once any whose date has passed are taken as paid from it. */
  reservedMinor: number;
  remainingMinor: number;
  /** When the next one is due; null when not known. */
  dueDate: string | null;
  /** The date given has passed. Bills since are taken as paid from what was reserved, and figures are for the next one. */
  dueDatePassed: boolean;
  /** Whole months to set money aside in, this one included; at least 1. Null without a date. */
  monthsLeft: number | null;
  /** What to set aside each month to have it all by the due date. Null without a date. */
  catchUpMonthlyMinor: number | null;
}

/** What to set aside for a bill that comes less often than monthly. */
export function calcSinkingFund(input: SinkingFundInput): SinkingFundResult {
  const amount = int('amountMinor', input.amountMinor);
  const every = int('everyMonths', input.everyMonths, 60);
  if (every === 0) throw new CalcError('invalid_input', 'everyMonths must be at least 1');
  const today = toDay(input.today);
  const given = input.nextDueDate ? toDay(input.nextDueDate) : null;
  let due = given;
  let passed = 0;
  // Each step counts from the date given, so the 31st stays the 31st.
  while (due !== null && due < today) due = addMonthsToDay(given!, ++passed * every);
  const reserved = Math.max(0, int('reservedMinor', input.reservedMinor, MAX_TOTAL) - passed * amount);

  const remaining = Math.max(0, amount - reserved);
  const monthsLeft = due === null ? null : Math.max(1, monthsBetween(today, due));
  return {
    steadyMonthlyMinor: Math.ceil(amount / every),
    reservedMinor: reserved,
    remainingMinor: remaining,
    dueDate: due,
    dueDatePassed: passed > 0,
    monthsLeft,
    catchUpMonthlyMinor: monthsLeft === null ? null : Math.ceil(remaining / monthsLeft),
  };
}
