import { desc, eq, schema } from '@fin/db';
import type { z } from 'zod';
import { actorColumns, getUserKey, type Actor, type Ctx } from './context';
import { openJson, sealJson } from './crypto';
import type { PlanVersion } from './plans';
import { checkInInput, type CheckInInput } from './schemas';

const { checkIns, plans } = schema;

type Stored = Pick<CheckInInput, 'actuals' | 'note'>;

export interface CheckIn extends Stored {
  id: string;
  periodStart: string;
  periodEnd: string;
  loggedAt: Date;
  loggedBy: 'user' | 'agent';
  /** The plan version that was current when this was logged, if there was one. */
  planVersionId: string | null;
}

const aad = (userId: string, id: string) => `check_ins:${userId}:${id}`;

/** Records what actually happened over a period, linked to the plan that was current at the time. */
export async function logCheckIn(
  ctx: Ctx,
  userId: string,
  actor: Actor,
  input: z.input<typeof checkInInput>,
): Promise<{ id: string }> {
  const { periodStart, periodEnd, actuals, note } = checkInInput.parse(input);
  const key = await getUserKey(ctx, userId);
  const [plan] = await ctx.db.select().from(plans).where(eq(plans.userId, userId));
  const id = crypto.randomUUID();
  const stored: Stored = { actuals, note };
  await ctx.db.insert(checkIns).values({
    id,
    userId,
    planVersionId: plan?.currentVersionId ?? null,
    periodStart,
    periodEnd,
    ...actorColumns(actor),
    data: sealJson(key, aad(userId, id), stored),
  });
  return { id };
}

export async function listCheckIns(ctx: Ctx, userId: string, limit = 24): Promise<CheckIn[]> {
  const rows = await ctx.db
    .select()
    .from(checkIns)
    .where(eq(checkIns.userId, userId))
    .orderBy(desc(checkIns.periodEnd), desc(checkIns.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const key = await getUserKey(ctx, userId);
  return rows.map((row) => ({
    ...openJson<Stored>(key, aad(userId, row.id), row.data),
    id: row.id,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    loggedAt: row.createdAt,
    loggedBy: row.actorType,
    planVersionId: row.planVersionId,
  }));
}

export interface Variance {
  /** Length of the check-in period, counting both end dates. */
  periodDays: number;
  /** One line per budget category that was planned or spent on. Positive difference = over plan. */
  spending: { category: string; plannedMinor: number; actualMinor: number; differenceMinor: number }[];
  income: { plannedMinor: number; actualMinor: number; differenceMinor: number };
  debtPayments: { plannedMinor: number; actualMinor: number; differenceMinor: number };
}

const line = (plannedMinor: number, actualMinor: number) => ({ plannedMinor, actualMinor, differenceMinor: actualMinor - plannedMinor });

/**
 * Compares what happened with what the plan said. Plans are monthly, so planned
 * figures are scaled to the length of the period (a month is taken as 365.25 / 12 days).
 */
export function checkInVariance(checkIn: Pick<CheckIn, 'periodStart' | 'periodEnd' | 'actuals'>, plan: PlanVersion): Variance | null {
  if (!plan.results) return null;
  const periodDays = Math.round((Date.parse(checkIn.periodEnd) - Date.parse(checkIn.periodStart)) / 86_400_000) + 1;
  const scale = (monthlyMinor: number) => Math.round((monthlyMinor * periodDays * 12) / 365.25);
  const planned = new Map<string, number>();
  for (const row of plan.inputs.budget) planned.set(row.category, (planned.get(row.category) ?? 0) + row.amountMinor);
  const actual = new Map<string, number>();
  for (const row of checkIn.actuals.spending) actual.set(row.category, (actual.get(row.category) ?? 0) + row.amountMinor);
  const categories = [...new Set([...planned.keys(), ...actual.keys()])].sort();
  return {
    periodDays,
    spending: categories.map((category) => ({ category, ...line(scale(planned.get(category) ?? 0), actual.get(category) ?? 0) })),
    income: line(scale(plan.results.monthly.incomeMinor), checkIn.actuals.incomeMinor),
    debtPayments: line(scale(plan.results.monthly.debtPaymentsMinor), checkIn.actuals.debtPaymentsMinor),
  };
}
