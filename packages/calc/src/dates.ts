import { CalcError } from './util';

const DAY = 86_400_000;
const PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Years a plan can be about. Outside them dates stop being four digits and no longer sort. */
export const FIRST_DAY = '1900-01-01';
export const LAST_DAY = '2200-12-31';

/** Checks a calendar date, "2026-11-24". */
export function toDay(date: string): string {
  if (date < FIRST_DAY || date > LAST_DAY) throw new CalcError('invalid_input', `Dates must look like 2026-11-24 and fall between ${FIRST_DAY} and ${LAST_DAY}`);
  const time = PATTERN.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  // Date.parse accepts 31 February and rolls it on; a real date survives the round trip.
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new CalcError('invalid_input', 'Dates must look like 2026-11-24');
  return date;
}

export const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
export const daysInMonth = (month: string): number => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
/** Whole calendar months from one date's month to another's. */
export const monthsBetween = (from: string, to: string): number => monthIndex(to) - monthIndex(from);

/** The same day `count` months on, or the last day of a month that is too short. */
export function addMonthsToDay(date: string, count: number): string {
  const index = monthIndex(date) + count;
  const month = `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
  return `${month}-${String(Math.min(Number(date.slice(8)), daysInMonth(month))).padStart(2, '0')}`;
}

/** How often something repeats: every so many days, or every so many months. */
export type Interval = { days: number } | { months: number };

/** The dates from `from` to `to`, both included, on which something repeats that falls on `anchor`. */
export function occurrences(anchor: string, interval: Interval, from: string, to: string): string[] {
  const at = (n: number) => ('days' in interval ? addDays(anchor, n * interval.days) : addMonthsToDay(anchor, n * interval.months));
  // Start just before the window rather than at the anchor, which may be years back.
  const steps = 'days' in interval ? Math.floor(daysBetween(anchor, from) / interval.days) : Math.floor(monthsBetween(anchor, from) / interval.months);
  const dates: string[] = [];
  // Counting from the anchor each time keeps a bill due on the 31st on the 31st after a short month.
  for (let n = Math.max(0, steps); at(n) <= to; n++) if (at(n) >= from) dates.push(at(n));
  return dates;
}
