import { and, desc, eq, gte, isNull, schema, sql } from '@fin/db';
import type { z } from 'zod';
import { actorColumns, getUserKey, NotFoundError, type Actor, type Ctx } from './context';
import { openJson, sealJson } from './crypto';
import { incomeReceiptInput, type IncomeReceiptInput } from './schemas';

const { incomeActuals } = schema;
const aad = (userId: string, id: string) => `income_actuals:${userId}:${id}`;

/** Money that arrived on a day. */
export interface IncomeReceipt extends IncomeReceiptInput {
  id: string;
  loggedBy: 'user' | 'agent';
  loggedAt: Date;
  /** When the user took it back; it is kept, but nothing counts it. */
  voidedAt: Date | null;
}

export async function logIncome(ctx: Ctx, userId: string, actor: Actor, input: z.input<typeof incomeReceiptInput>): Promise<{ id: string }> {
  const receipt = incomeReceiptInput.parse(input);
  const key = await getUserKey(ctx, userId);
  const id = crypto.randomUUID();
  await ctx.db.insert(incomeActuals).values({ id, userId, month: receipt.receivedOn.slice(0, 7), ...actorColumns(actor), data: sealJson(key, aad(userId, id), receipt) });
  return { id };
}

/** Newest first. */
export async function listIncome(ctx: Ctx, userId: string, options: { sinceMonth?: string; includeVoided?: boolean; limit?: number } = {}): Promise<IncomeReceipt[]> {
  const rows = await ctx.db
    .select()
    .from(incomeActuals)
    .where(
      and(
        eq(incomeActuals.userId, userId),
        options.sinceMonth ? gte(incomeActuals.month, options.sinceMonth) : undefined,
        options.includeVoided ? undefined : isNull(incomeActuals.voidedAt),
      ),
    )
    .orderBy(desc(incomeActuals.month), desc(incomeActuals.createdAt))
    .limit(options.limit ?? 200);
  if (rows.length === 0) return [];
  const key = await getUserKey(ctx, userId);
  return rows
    .map((row) => ({ ...openJson<IncomeReceiptInput>(key, aad(userId, row.id), row.data), id: row.id, loggedBy: row.actorType, loggedAt: row.createdAt, voidedAt: row.voidedAt }))
    .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn));
}

/** Takes a receipt back, or puts it back. Only ever called on behalf of the signed-in user. */
export async function setIncomeVoided(ctx: Ctx, userId: string, id: string, voided: boolean): Promise<void> {
  const updated = await ctx.db
    .update(incomeActuals)
    .set({ voidedAt: voided ? sql`now()` : null })
    .where(and(eq(incomeActuals.id, id), eq(incomeActuals.userId, userId)))
    .returning({ id: incomeActuals.id });
  if (updated.length === 0) throw new NotFoundError('Receipt');
}
