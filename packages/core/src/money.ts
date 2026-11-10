/**
 * Amounts are whole numbers of a currency's smallest unit ("minor units"):
 * 1050 means 10.50 in USD, 1050 in JPY (no decimals), and 1.050 in KWD (three).
 */

export function isSupportedCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && Intl.supportedValuesOf('currency').includes(code);
}

export function listCurrencies(): string[] {
  return Intl.supportedValuesOf('currency');
}

/** Number of decimal places the currency uses (2 for most, 0 for JPY, 3 for KWD). */
export function minorDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** Parses what a person typed ("1,250.50") into minor units. Returns null if it is not an amount. */
export function parseAmount(input: string, currency: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '');
  const match = /^(\d{1,13})(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;
  const digits = minorDigits(currency);
  const fraction = match[2] ?? '';
  if (fraction.length > digits) return null;
  return Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
}

export function formatAmount(minor: number, currency: string, locale = 'en'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    minor / 10 ** minorDigits(currency),
  );
}

/** Plain decimal string for form fields, e.g. 125050 -> "1250.50". */
export function toDecimalString(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

export const FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

const PER_YEAR: Record<Frequency, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

/** Converts a recurring amount to its monthly equivalent, rounded to the nearest minor unit. */
export function toMonthly(amountMinor: number, frequency: Frequency): number {
  return Math.round((amountMinor * PER_YEAR[frequency]) / 12);
}
