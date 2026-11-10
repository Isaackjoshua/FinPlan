import { and, desc, eq, max, schema } from '@fin/db';
import type { z } from 'zod';
import {
  actorColumns,
  ConflictError,
  getUserKey,
  NotFoundError,
  type Actor,
  type Ctx,
} from './context';
import { openJson, sealJson } from './crypto';
import { computePlanResults, type PlanResults } from './planResults';
import { listGoals, listItems } from './profile';
import { planVersionInput, type PlanInputs } from './schemas';

const { plans, planVersions, planEvents } = schema;

interface StoredPlan {
  summary: string;
  inputs: PlanInputs;
  /** Null only for versions saved before the calculation engine existed. */
  results: PlanResults | null;
}

export interface PlanVersion extends StoredPlan {
  version: number;
  savedAt: Date;
  savedBy: 'user' | 'agent';
  isCurrent: boolean;
}

const aad = (userId: string, id: string) => `plan_versions:${userId}:${id}`;

/** Locks the user's plan row (creating it if needed) so version numbers cannot collide. */
async function lockPlan(tx: Parameters<Parameters<Ctx['db']['transaction']>[0]>[0], userId: string) {
  await tx.insert(plans).values({ userId }).onConflictDoNothing();
  const [plan] = await tx.select().from(plans).where(eq(plans.userId, userId)).for('update');
  if (!plan) throw new NotFoundError('Plan');
  const [current] = plan.currentVersionId
    ? await tx.select().from(planVersions).where(eq(planVersions.id, plan.currentVersionId))
    : [];
  return { current };
}

/** Saves a new immutable version and makes it current. Earlier versions are untouched. */
export async function savePlanVersion(
  ctx: Ctx,
  userId: string,
  actor: Actor,
  input: z.input<typeof planVersionInput>,
  /** The moment of saving; projections count from this month. Passed in so tests are repeatable. */
  now: Date = new Date(),
): Promise<{ version: number; results: PlanResults }> {
  const { summary, inputs, baseVersion } = planVersionInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const { current } = await lockPlan(tx, userId);
    if (baseVersion !== undefined && baseVersion !== current?.versionNumber) {
      throw new ConflictError(
        `The current plan is version ${current?.versionNumber ?? 'none'}, not ${baseVersion}; re-read it and try again`,
      );
    }
    const [latest] = await tx
      .select({ n: max(planVersions.versionNumber) })
      .from(planVersions)
      .where(eq(planVersions.userId, userId));
    const version = (latest?.n ?? 0) + 1;
    const id = crypto.randomUUID();
    const key = await getUserKey(ctx, userId, tx);
    // Projections are worked out here, from the profile as it stands at this moment.
    const results = computePlanResults(
      await listItems(ctx, userId, undefined, tx),
      await listGoals(ctx, userId, tx),
      inputs,
      now.toISOString().slice(0, 7),
    );
    const stored: StoredPlan = { summary, inputs, results };

    await tx.insert(planVersions).values({
      id,
      userId,
      versionNumber: version,
      parentVersionId: current?.id ?? null,
      ...actorColumns(actor),
      engineVersion: results.engineVersion,
      data: sealJson(key, aad(userId, id), stored),
    });
    await tx.update(plans).set({ currentVersionId: id }).where(eq(plans.userId, userId));
    await tx.insert(planEvents).values({
      userId,
      kind: 'saved',
      fromVersion: current?.versionNumber ?? null,
      toVersion: version,
      ...actorColumns(actor),
    });
    return { version, results };
  });
}

/**
 * Makes an earlier (or later) version current again. Only ever called on behalf of
 * the signed-in user: this is how they undo an agent's change, so agents get no
 * equivalent tool.
 */
export async function revertToVersion(ctx: Ctx, userId: string, version: number): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const { current } = await lockPlan(tx, userId);
    const [target] = await tx
      .select()
      .from(planVersions)
      .where(and(eq(planVersions.userId, userId), eq(planVersions.versionNumber, version)));
    if (!target) throw new NotFoundError('Plan version');
    if (target.id === current?.id) return;
    await tx.update(plans).set({ currentVersionId: target.id }).where(eq(plans.userId, userId));
    await tx.insert(planEvents).values({
      userId,
      kind: 'reverted',
      fromVersion: current?.versionNumber ?? null,
      toVersion: version,
      actorType: 'user',
    });
  });
}

export async function listPlanVersions(ctx: Ctx, userId: string): Promise<PlanVersion[]> {
  const rows = await ctx.db
    .select()
    .from(planVersions)
    .where(eq(planVersions.userId, userId))
    .orderBy(desc(planVersions.versionNumber));
  if (rows.length === 0) return [];
  const [plan] = await ctx.db.select().from(plans).where(eq(plans.userId, userId));
  const key = await getUserKey(ctx, userId);
  return rows.map((row) => ({
    ...openJson<StoredPlan>(key, aad(userId, row.id), row.data),
    version: row.versionNumber,
    savedAt: row.createdAt,
    savedBy: row.actorType,
    isCurrent: row.id === plan?.currentVersionId,
  }));
}

export async function getPlanVersion(ctx: Ctx, userId: string, version: number): Promise<PlanVersion> {
  const found = (await listPlanVersions(ctx, userId)).find((v) => v.version === version);
  if (!found) throw new NotFoundError('Plan version');
  return found;
}

export async function getCurrentPlan(ctx: Ctx, userId: string): Promise<PlanVersion | null> {
  return (await listPlanVersions(ctx, userId)).find((v) => v.isCurrent) ?? null;
}
