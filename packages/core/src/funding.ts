import { calcFeasibility, type FeasibilityResult } from '@fin/calc';
import type { Goal, Item } from './profile';

const LAST = 1000;

/** The order goals come in line for money: by funding order, then by priority, then oldest first. */
export function inFundingOrder<G extends Pick<Goal, 'fundingOrder' | 'priority'>>(goals: G[]): G[] {
  return [...goals].sort((a, b) => (a.fundingOrder ?? LAST) - (b.fundingOrder ?? LAST) || a.priority - b.priority);
}

/**
 * Goals with the progress they really have. A goal linked to savings has what is in them. When
 * several share the same savings each first gets what was put there for it, then the first in
 * line has first call on the rest, so no money counts twice.
 */
export function effectiveGoals(goals: Goal[], items: Item[]): Goal[] {
  const balances = new Map(items.flatMap((item) => (item.kind === 'savings' ? [[item.id, item.balanceMinor] as const] : [])));
  const progress = new Map<string, number>();
  const linked = inFundingOrder(goals.filter((g) => g.status === 'active' && g.savingsItemId && balances.has(g.savingsItemId)));
  for (const upTo of [(goal: Goal) => Math.min(goal.currentAmountMinor, goal.targetAmountMinor), (goal: Goal) => goal.targetAmountMinor]) {
    for (const goal of linked) {
      const balance = balances.get(goal.savingsItemId!)!;
      const has = progress.get(goal.id) ?? 0;
      const share = Math.min(balance, Math.max(0, upTo(goal) - has));
      balances.set(goal.savingsItemId!, balance - share);
      progress.set(goal.id, has + share);
    }
  }
  return goals.map((goal) => (progress.has(goal.id) ? { ...goal, currentAmountMinor: progress.get(goal.id)! } : goal));
}

/** Whether a goal can be met by its date. `goal` should come from `effectiveGoals`. */
export function goalFeasibility(goal: Goal, leftOver: { leanMinor: number; typicalMinor: number | null; goodMinor: number | null }, today: string): FeasibilityResult {
  return calcFeasibility({ remainingMinor: Math.max(0, goal.targetAmountMinor - goal.currentAmountMinor), targetDate: goal.targetDate, today, leftOver });
}
