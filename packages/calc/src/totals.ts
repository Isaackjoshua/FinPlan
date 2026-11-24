import { add, CalcError, int } from './util';

export interface TotalsInput {
  lines: { id: string; amountMinor: number; timesPerYear: number; group?: string }[];
}

export interface TotalsResult {
  /** Each line as given, and what it comes to in an average month and in a year. */
  lines: { id: string; amountMinor: number; monthlyMinor: number; yearlyMinor: number }[];
  groups: { group: string; monthlyMinor: number; yearlyMinor: number }[];
  monthlyMinor: number;
  yearlyMinor: number;
}

/** Adds up amounts that come at different intervals. Monthly figures are each line's, rounded, then added. */
export function calcTotals(input: TotalsInput): TotalsResult {
  if (!Array.isArray(input.lines) || input.lines.length > 200) throw new CalcError('invalid_input', 'lines must be a list of at most 200 items');
  const groups = new Map<string, { monthlyMinor: number; yearlyMinor: number }>();
  let monthly = 0;
  let yearly = 0;
  const lines = input.lines.map((line, i) => {
    const amount = int(`lines[${i}].amountMinor`, line.amountMinor);
    const yearlyMinor = amount * int(`lines[${i}].timesPerYear`, line.timesPerYear, 366);
    const monthlyMinor = Math.round(yearlyMinor / 12);
    monthly = add(monthly, monthlyMinor);
    yearly = add(yearly, yearlyMinor);
    if (line.group !== undefined) {
      const group = groups.get(line.group) ?? { monthlyMinor: 0, yearlyMinor: 0 };
      groups.set(line.group, { monthlyMinor: group.monthlyMinor + monthlyMinor, yearlyMinor: group.yearlyMinor + yearlyMinor });
    }
    return { id: line.id, amountMinor: amount, monthlyMinor, yearlyMinor };
  });
  return { lines, groups: [...groups].map(([group, sums]) => ({ group, ...sums })), monthlyMinor: monthly, yearlyMinor: yearly };
}
