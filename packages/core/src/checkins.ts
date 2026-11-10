import { desc, eq, schema } from '@fin/db';
import type { z } from 'zod';
import { actorColumns, getUserKey, type Actor, type Ctx } from './context';
import { openJson, sealJson } from './crypto';
import { checkInInput, type CheckInInput } from './schemas';

const { checkIns, plans } = schema;

type Stored = Pick<CheckInInput, 'actuals' | 'note'>;

export interface CheckIn extends Stored {
  id: string;
  periodStart: string;
  periodEnd: string;
  loggedAt: Date;
  loggedBy: 'user' | 'agent';
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
  }));
}
