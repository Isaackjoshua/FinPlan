import { addMonths } from '@fin/calc';
import { and, desc, eq, gte, isNull, schema, sql, type Executor } from '@fin/db';
import type { z } from 'zod';
import { actorColumns, getUserKey, NotFoundError, type Actor, type Ctx } from './context';
import { openJson, sealJson } from './crypto';
import { incomeHistory, type IncomeHistory } from './history';
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
  /** When the user took it back; it is kept, but nothing counts it. */
  voidedAt: Date | null;
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

export async function listCheckIns(
  ctx: Ctx,
  userId: string,
  limit = 24,
  { includeVoided = false, since, exec = ctx.db }: { includeVoided?: boolean; /** Only those ending on or after this date. */ since?: string; exec?: Executor } = {},
): Promise<CheckIn[]> {
  const rows = await exec
    .select()
    .from(checkIns)
    .where(and(eq(checkIns.userId, userId), includeVoided ? undefined : isNull(checkIns.voidedAt), since ? gte(checkIns.periodEnd, since) : undefined))
    .orderBy(desc(checkIns.periodEnd), desc(checkIns.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const key = await getUserKey(ctx, userId, exec);
  return rows.map((row) => ({
    ...openJson<Stored>(key, aad(userId, row.id), row.data),
    id: row.id,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    loggedAt: row.createdAt,
    loggedBy: row.actorType,
    planVersionId: row.planVersionId,
    voidedAt: row.voidedAt,
  }));
}

/** Takes a check-in back, or puts it back. Only ever called on behalf of the signed-in user: it is how they undo one an agent logged. */
export async function setCheckInVoided(ctx: Ctx, userId: string, id: string, voided: boolean): Promise<void> {
  const updated = await ctx.db
    .update(checkIns)
    .set({ voidedAt: voided ? sql`now()` : null })
    .where(and(eq(checkIns.id, id), eq(checkIns.userId, userId)))
    .returning({ id: checkIns.id });
  if (updated.length === 0) throw new NotFoundError('Check-in');
}

/** Months looked back over for the twelve that count. Whole months, so that none is cut short. */
const HISTORY_MONTHS = 24;

/** What the user's check-ins show about their income. */
export async function getIncomeHistory(ctx: Ctx, userId: string, today: string, exec: Executor = ctx.db): Promise<IncomeHistory> {
  return incomeHistory(await listCheckIns(ctx, userId, 5000, { exec, since: `${addMonths(today.slice(0, 7), -HISTORY_MONTHS)}-01` }), today);
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
