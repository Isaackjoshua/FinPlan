import { listCheckIns } from './checkins';
import type { Ctx } from './context';
import { getLessonStates } from './lessons';
import { listPlanVersions } from './plans';
import { listGoals, listItems } from './profile';
import { summarise } from './summary';

export interface Progress {
  goals: { id: string; status: string; percent: number; remainingMinor: number }[];
  totalDebtMinor: number;
  totalSavingsMinor: number;
  emergencyFundMinor: number;
  plan: { versions: number; currentVersion: number | null; lastSavedAt: Date | null };
  checkIns: { count: number; lastPeriodEnd: string | null; debtPaymentsLoggedMinor: number; savingsAddedLoggedMinor: number };
  lessons: { assigned: number; completed: number; quizzes: { slug: string; bestScore: number }[] };
}

/** How the user is getting on, as figures an agent can report without reading every record. */
export async function getProgress(ctx: Ctx, userId: string): Promise<Progress> {
  const [goals, items, versions, checkIns, lessonStates] = await Promise.all([
    listGoals(ctx, userId),
    listItems(ctx, userId),
    listPlanVersions(ctx, userId),
    listCheckIns(ctx, userId, 120),
    getLessonStates(ctx, userId),
  ]);
  const summary = summarise(items);
  const states = [...lessonStates.entries()];
  return {
    goals: goals.map((g) => ({
      id: g.id,
      status: g.status,
      percent: g.targetAmountMinor === 0 ? 100 : Math.min(100, Math.floor((g.currentAmountMinor * 100) / g.targetAmountMinor)),
      remainingMinor: Math.max(0, g.targetAmountMinor - g.currentAmountMinor),
    })),
    totalDebtMinor: summary.totalDebt,
    totalSavingsMinor: summary.totalSavings,
    emergencyFundMinor: summary.emergencyFund,
    plan: {
      versions: versions.length,
      currentVersion: versions.find((v) => v.isCurrent)?.version ?? null,
      lastSavedAt: versions[0]?.savedAt ?? null,
    },
    checkIns: {
      count: checkIns.length,
      lastPeriodEnd: checkIns[0]?.periodEnd ?? null,
      debtPaymentsLoggedMinor: checkIns.reduce((sum, c) => sum + c.actuals.debtPaymentsMinor, 0),
      savingsAddedLoggedMinor: checkIns.reduce((sum, c) => sum + c.actuals.savingsAddedMinor, 0),
    },
    lessons: {
      assigned: states.filter(([, s]) => s.assignment?.status === 'assigned').length,
      completed: states.filter(([, s]) => s.status === 'completed').length,
      quizzes: states.flatMap(([slug, s]) => (s.bestScore === null ? [] : [{ slug, bestScore: s.bestScore }])),
    },
  };
}
