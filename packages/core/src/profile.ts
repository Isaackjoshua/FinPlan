import { and, asc, eq, isNull, schema, sql, type Executor } from '@fin/db';
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
import {
  goalData,
  goalStatus,
  itemData,
  profileDetails,
  profileSetup,
  type GoalData,
  type GoalStatus,
  type ItemData,
  type ItemKind,
  type ProfileDetails,
} from './schemas';

const { profiles, profileItems, goals, profileRevisions } = schema;

export interface Profile extends ProfileDetails {
  country: string;
  currency: string;
  revision: number;
}
export type Item = ItemData & { id: string };
export type Goal = GoalData & { id: string; status: GoalStatus };

const aad = {
  profile: (userId: string) => `profiles:${userId}`,
  item: (userId: string, id: string) => `profile_items:${userId}:${id}`,
  goal: (userId: string, id: string) => `goals:${userId}:${id}`,
  revision: (userId: string, revision: number) => `profile_revisions:${userId}:${revision}`,
};

// --- Reads -----------------------------------------------------------------

export async function getProfile(ctx: Ctx, userId: string, exec: Executor = ctx.db): Promise<Profile | null> {
  const [row] = await exec.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!row) return null;
  const key = await getUserKey(ctx, userId, exec);
  return {
    country: row.country,
    currency: row.currency,
    revision: row.revision,
    ...openJson<ProfileDetails>(key, aad.profile(userId), row.data),
  };
}

export async function listItems(ctx: Ctx, userId: string, kind?: ItemKind, exec: Executor = ctx.db): Promise<Item[]> {
  const rows = await exec
    .select()
    .from(profileItems)
    .where(
      and(
        eq(profileItems.userId, userId),
        isNull(profileItems.archivedAt),
        kind ? eq(profileItems.kind, kind) : undefined,
      ),
    )
    .orderBy(asc(profileItems.createdAt));
  if (rows.length === 0) return [];
  const key = await getUserKey(ctx, userId, exec);
  return rows.map((row) => ({
    ...openJson<ItemData>(key, aad.item(userId, row.id), row.data),
    id: row.id,
  }));
}

export async function listGoals(ctx: Ctx, userId: string, exec: Executor = ctx.db): Promise<Goal[]> {
  const rows = await exec.select().from(goals).where(eq(goals.userId, userId)).orderBy(asc(goals.createdAt));
  if (rows.length === 0) return [];
  const key = await getUserKey(ctx, userId, exec);
  return rows.map((row) => ({
    ...openJson<GoalData>(key, aad.goal(userId, row.id), row.data),
    id: row.id,
    status: row.status,
  }));
}

// --- Writes ----------------------------------------------------------------

/** Creates the profile at onboarding. The currency is fixed from then on. */
export async function setupProfile(ctx: Ctx, userId: string, input: z.input<typeof profileSetup>): Promise<void> {
  const { country, currency } = profileSetup.parse(input);
  const key = await getUserKey(ctx, userId);
  await ctx.db
    .insert(profiles)
    .values({ userId, country, currency, data: sealJson(key, aad.profile(userId), {}) })
    .onConflictDoNothing();
}

export interface WriteOptions {
  /** Reject the write unless the profile is still at this revision. */
  expectedRevision?: number;
}

/**
 * Every change to the profile, its items, or goals goes through here. It holds a
 * row lock on the profile so concurrent writers queue up, checks the caller's
 * revision, snapshots the previous state when the writer is an agent (so the user
 * can undo it), and bumps the revision.
 */
async function mutate<T>(
  ctx: Ctx,
  userId: string,
  actor: Actor,
  options: WriteOptions,
  change: (tx: Executor, key: Buffer) => Promise<T>,
): Promise<{ revision: number; result: T }> {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).for('update');
    if (!row) throw new NotFoundError('Profile');
    if (options.expectedRevision !== undefined && options.expectedRevision !== row.revision) {
      throw new ConflictError(`Profile is at revision ${row.revision}; re-read it and try again`);
    }
    const key = await getUserKey(ctx, userId, tx);

    if (actor.type === 'agent') {
      const snapshot = {
        profile: await getProfile(ctx, userId, tx),
        items: await listItems(ctx, userId, undefined, tx),
        goals: await listGoals(ctx, userId, tx),
      };
      await tx.insert(profileRevisions).values({
        userId,
        revision: row.revision,
        ...actorColumns(actor),
        data: sealJson(key, aad.revision(userId, row.revision), snapshot),
      });
    }

    const result = await change(tx, key);
    const revision = row.revision + 1;
    await tx.update(profiles).set({ revision }).where(eq(profiles.userId, userId));
    return { revision, result };
  });
}

export async function updateProfileDetails(
  ctx: Ctx,
  userId: string,
  actor: Actor,
  input: z.input<typeof profileDetails>,
  options: WriteOptions = {},
) {
  const details = profileDetails.parse(input);
  return mutate(ctx, userId, actor, options, async (tx, key) => {
    await tx
      .update(profiles)
      .set({ data: sealJson(key, aad.profile(userId), details) })
      .where(eq(profiles.userId, userId));
  });
}

/** Creates an item, or replaces one when `id` is given. An item cannot change kind. */
export async function upsertItem(
  ctx: Ctx,
  userId: string,
  actor: Actor,
  input: z.input<typeof itemData> & { id?: string },
  options: WriteOptions = {},
) {
  const data = itemData.parse(input);
  return mutate(ctx, userId, actor, options, async (tx, key) => {
    if (input.id) {
      const updated = await tx
        .update(profileItems)
        .set({ data: sealJson(key, aad.item(userId, input.id), data) })
        // user_id is part of every WHERE clause: knowing an id is never enough.
        .where(and(eq(profileItems.id, input.id), eq(profileItems.userId, userId), eq(profileItems.kind, data.kind)))
        .returning({ id: profileItems.id });
      if (updated.length === 0) throw new NotFoundError('Item');
      return input.id;
    }
    const id = crypto.randomUUID();
    await tx
      .insert(profileItems)
      .values({ id, userId, kind: data.kind, data: sealJson(key, aad.item(userId, id), data) });
    return id;
  });
}

/** Hides an item from the profile. Nothing is deleted. */
export async function archiveItem(ctx: Ctx, userId: string, actor: Actor, id: string, options: WriteOptions = {}) {
  return mutate(ctx, userId, actor, options, async (tx) => {
    const updated = await tx
      .update(profileItems)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(profileItems.id, id), eq(profileItems.userId, userId), isNull(profileItems.archivedAt)))
      .returning({ id: profileItems.id });
    if (updated.length === 0) throw new NotFoundError('Item');
  });
}

export async function createGoal(
  ctx: Ctx,
  userId: string,
  actor: Actor,
  input: z.input<typeof goalData>,
  options: WriteOptions = {},
) {
  const data = goalData.parse(input);
  return mutate(ctx, userId, actor, options, async (tx, key) => {
    const id = crypto.randomUUID();
    await tx.insert(goals).values({ id, userId, data: sealJson(key, aad.goal(userId, id), data) });
    return id;
  });
}

export async function updateGoal(
  ctx: Ctx,
  userId: string,
  actor: Actor,
  id: string,
  changes: Partial<z.input<typeof goalData>> & { status?: GoalStatus },
  options: WriteOptions = {},
) {
  return mutate(ctx, userId, actor, options, async (tx, key) => {
    const [row] = await tx.select().from(goals).where(and(eq(goals.id, id), eq(goals.userId, userId)));
    if (!row) throw new NotFoundError('Goal');
    const { status, ...fields } = changes;
    const current = openJson<GoalData>(key, aad.goal(userId, id), row.data);
    const next = goalData.parse({ ...current, ...fields });
    await tx
      .update(goals)
      .set({
        data: sealJson(key, aad.goal(userId, id), next),
        status: status ? goalStatus.parse(status) : row.status,
      })
      .where(and(eq(goals.id, id), eq(goals.userId, userId)));
    return Object.keys(changes);
  });
}
