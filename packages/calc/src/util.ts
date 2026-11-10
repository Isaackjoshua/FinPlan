/**
 * Shared rules for every calculator:
 *  - amounts are whole numbers of minor units (cents, yen, fils);
 *  - rates are annual, in basis points (1999 = 19.99%), applied monthly as rate / 12;
 *  - nothing here reads the clock, the network or a database. Same input, same output.
 */

/** Bump when any calculation changes, so saved plans record which rules produced them. */
export const ENGINE_VERSION = '1.0.0';

export const MAX_AMOUNT = 1e13;
export const MAX_RATE_BPS = 100_000;
export const MAX_MONTHS = 600;

export class CalcError extends Error {
  constructor(
    /** Stable identifier callers can branch on. */
    public readonly code: 'invalid_input' | 'out_of_range',
    message: string,
  ) {
    super(message);
    this.name = 'CalcError';
  }
}

/** Checks a whole number between 0 and `max` and returns it. */
export function int(name: string, value: unknown, max: number = MAX_AMOUNT): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw new CalcError('invalid_input', `${name} must be a whole number between 0 and ${max}`);
  }
  return value;
}

/**
 * One month of interest on a balance, rounded half up to the nearest minor unit.
 * The multiplication runs in BigInt because balance × rate can exceed the range
 * in which ordinary numbers are exact.
 */
export function monthlyInterest(balanceMinor: number, annualRateBps: number): number {
  return Number((BigInt(balanceMinor) * BigInt(annualRateBps) + 60_000n) / 120_000n);
}

/** Adds two amounts, refusing results too large to be exact. */
export function add(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new CalcError('out_of_range', 'The result is too large to calculate exactly');
  return sum;
}

/** Accepts "2026-11" or "2026-11-10" and returns "2026-11". */
export function toMonth(date: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])(-\d{2})?$/.exec(date);
  if (!match) throw new CalcError('invalid_input', 'startDate must look like 2026-11 or 2026-11-10');
  return `${match[1]}-${match[2]}`;
}

/** "2026-11" plus 3 months is "2027-02". */
export function addMonths(month: string, count: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Splits `total` by percentages that sum to 100, so the parts always add back to `total`. */
export function splitByPercent(total: number, percents: number[]): number[] {
  const exact = percents.map((p) => (total * p) / 100);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  // Hand the leftover units to the parts that lost the most to rounding down.
  const byRemainder = exact.map((x, i) => [x - parts[i]!, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of byRemainder) {
    if (left === 0) break;
    parts[i]! += 1;
    left -= 1;
  }
  return parts;
}
