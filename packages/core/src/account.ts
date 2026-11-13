import { eq, schema } from '@fin/db';
import { listActivity, listConnections, revokeConnection } from './agents';
import { listCheckIns } from './checkins';
import type { Ctx } from './context';
import { getLessonStates } from './lessons';
import { listPlanVersions } from './plans';
import { getProfile, listGoals, listItems } from './profile';

/** Everything FinPlan holds about a user, decrypted, for them to download. */
export async function exportUserData(ctx: Ctx, userId: string) {
  const [account] = await ctx.db
    .select({ name: schema.user.name, email: schema.user.email, createdAt: schema.user.createdAt })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  const [profile, items, goals, planVersions, checkIns, lessons, connections, activity] = await Promise.all([
    getProfile(ctx, userId),
    listItems(ctx, userId),
    listGoals(ctx, userId),
    listPlanVersions(ctx, userId),
    listCheckIns(ctx, userId, 1000),
    getLessonStates(ctx, userId),
    listConnections(ctx, userId),
    listActivity(ctx, userId, { limit: 200 }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    note: 'Amounts are whole numbers of minor units (for example cents). Rates are basis points (1999 = 19.99%). Items you removed from your profile are not included.',
    account,
    profile,
    items,
    goals,
    planVersions,
    checkIns,
    lessons: [...lessons].map(([slug, state]) => ({ slug, ...state })),
    connectedApps: connections,
    recentAppActivity: activity.map(({ userId: _user, ...row }) => row),
  };
}

/**
 * Deletes the account and everything attached to it. Connected apps are cut off
 * first. Removing the user's key row also makes their encrypted data unreadable
 * in any backup taken earlier.
 */
export async function deleteAccount(ctx: Ctx, userId: string): Promise<void> {
  for (const connection of await listConnections(ctx, userId)) await revokeConnection(ctx, userId, connection.id);
  // Every table that holds user data refers to this row with ON DELETE CASCADE.
  await ctx.db.delete(schema.user).where(eq(schema.user.id, userId));
}
