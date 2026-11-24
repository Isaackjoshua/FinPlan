import { FIRST_DAY, LAST_DAY, monthsBetween, toDay } from './dates';
import { SCENARIOS, type ScenarioName, type Band } from './scenarios';
import { int } from './util';

export interface FeasibilityInput {
  remainingMinor: number;
  /** When it is wanted by; without one there is nothing to check. */
  targetDate?: string | null;
  today: string;
  /** What a month leaves over before any goal, per kind of month. May be negative; null when not known. */
  leftOver: { [K in keyof Band]: number | null };
}

export interface FeasibilityResult {
  /** Whole months to save in, this one included; at least 1. Null when there is nothing to check. */
  monthsLeft: number | null;
  requiredMonthlyMinor: number | null;
  /** Whether each kind of month leaves over enough; null when that is not known or there is nothing to check. */
  scenarios: { scenario: ScenarioName; enough: boolean | null }[];
  /** `unreachable`: no kind of month known leaves over enough. */
  verdict: 'reached' | 'no_date' | 'date_passed' | 'reachable' | 'some_months_only' | 'unreachable';
}

/** Whether a goal can be met by its date out of what months leave over, counting this goal alone. */
export function calcFeasibility(input: FeasibilityInput): FeasibilityResult {
  const remaining = int('remainingMinor', input.remainingMinor);
  const today = toDay(input.today);
  const unchecked = (verdict: 'reached' | 'no_date' | 'date_passed'): FeasibilityResult => ({
    monthsLeft: null,
    requiredMonthlyMinor: null,
    scenarios: SCENARIOS.map((scenario) => ({ scenario, enough: null })),
    verdict,
  });
  if (remaining === 0) return unchecked('reached');
  if (!input.targetDate) return unchecked('no_date');

  // A goal may have been given a date further off than can be planned for; the last day stands in for it (or the first).
  const target = toDay(input.targetDate > LAST_DAY ? LAST_DAY : input.targetDate < FIRST_DAY ? FIRST_DAY : input.targetDate);
  if (target < today) return unchecked('date_passed');
  const monthsLeft = Math.max(1, monthsBetween(today, target));
  const required = Math.ceil(remaining / monthsLeft);
  const enough = (left: number | null) => (left === null ? null : left >= required);
  const { leanMinor, typicalMinor, goodMinor } = input.leftOver;
  const scenarios = ([['lean', leanMinor], ['typical', typicalMinor], ['good', goodMinor]] as const).map(([scenario, left]) => ({ scenario, enough: enough(left) }));
  const verdict =
    !scenarios.some((s) => s.enough) ? 'unreachable' : scenarios[0]!.enough ? 'reachable' : 'some_months_only';
  return { monthsLeft, requiredMonthlyMinor: required, scenarios, verdict };
}
