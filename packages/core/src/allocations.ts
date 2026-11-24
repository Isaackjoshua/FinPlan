import { calcAllocation, type AllocationResult } from '@fin/calc';
import { and, desc, eq, isNotNull, isNull, schema, sql, type Executor, type SQL } from '@fin/db';
import { actorColumns, ConflictError, getUserKey, NotFoundError, type Actor, type Ctx } from './context';
import { openJson, sealJson } from './crypto';
import { effectiveGoals, inFundingOrder } from './funding';
import { lumpyMonths, toMonthly } from './money';
import { applyMoves, getProfile, listGoals, listItems, type Goal, type Item, type Move } from './profile';
import { amount } from './schemas';
import { expensesOf, obligations, tierOf } from './spending';

const { allocations } = schema;
const aad = (userId: string, id: string) => `allocations:${userId}:${id}`;

/** What money is shared out to, in this order. */
export const ALLOCATION_GROUPS = ['survival', 'set_aside', 'debt', 'committed', 'goal', 'discretionary'] as const;
export type AllocationGroup = (typeof ALLOCATION_GROUPS)[number];

export interface AllocationLine {
  group: AllocationGroup;
  /** The expense, debt or goal. */
  id: string;
  wantedMinor: number;
  allocatedMinor: number;
  unmetMinor: number;
}

export interface AllocationPlan extends Omit<AllocationResult, 'lines' | 'firstUnmetId'> {
  lines: AllocationLine[];
  /** The profile's revision it was worked out at. If anything has changed since, it no longer fits. */
  revision: number;
}

/** As stored: with what confirming it changed, so that taking it back undoes exactly that. */
interface Stored extends AllocationPlan {
  made?: Move[];
}

export interface Allocation extends Stored {
  id: string;
  month: string;
  status: 'proposed' | 'confirmed' | 'discarded';
  madeBy: 'user' | 'agent';
  madeAt: Date;
}

/** What was set aside for each bill by what has been shared out. */
export function givenToBills(earlier: Pick<Allocation, 'lines'>[]): Map<string, number> {
  const given = new Map<string, number>();
  for (const line of earlier.flatMap((a) => a.lines)) if (line.group === 'set_aside') given.set(line.id, (given.get(line.id) ?? 0) + line.allocatedMinor);
  return given;
}

/**
 * Shares out money in order: survival costs, money set aside for big bills, minimum debt
 * payments, committed costs, then goals in line, then the rest of the spending. What was already
 * given this month is not asked for again. Goals move on only once the bills before them are met.
 */
export function shareOut(items: Item[], goals: Goal[], availableMinor: number, today: string, earlier: Pick<Allocation, 'lines'>[] = []): Omit<AllocationPlan, 'revision'> {
  const givenThisMonth = earlier.flatMap((a) => a.lines);
  const given = (group: AllocationGroup, id: string) => givenThisMonth.reduce((sum, line) => sum + (line.group === group && line.id === id ? line.allocatedMinor : 0), 0);
  const steps: { group: AllocationGroup; id: string; needMinor: number; capMinor?: number }[] = [];
  const spend = (group: 'survival' | 'committed' | 'discretionary') => {
    for (const e of expensesOf(items)) {
      if (tierOf(e) !== group || lumpyMonths(e.frequency) !== null) continue;
      steps.push({ group, id: e.id, needMinor: Math.max(0, toMonthly(e.amountMinor, e.frequency) - given(group, e.id)) });
    }
  };

  spend('survival');
  for (const o of obligations(items, today, givenToBills(earlier)).items) steps.push({ group: 'set_aside', id: o.id, needMinor: o.setAsideMinor });
  for (const item of items) {
    if (item.kind === 'debt') steps.push({ group: 'debt', id: item.id, needMinor: Math.max(0, Math.min(item.minimumPaymentMinor, item.balanceMinor) - given('debt', item.id)) });
  }
  spend('committed');
  for (const goal of inFundingOrder(effectiveGoals(goals, items).filter((g) => g.status === 'active'))) {
    const needMinor = Math.max(0, goal.targetAmountMinor - goal.currentAmountMinor);
    steps.push({ group: 'goal', id: goal.id, needMinor, ...(goal.monthlyCapMinor != null && { capMinor: Math.max(0, goal.monthlyCapMinor - given('goal', goal.id)) }) });
  }
  spend('discretionary');

  const wanted = steps.filter((step) => Math.min(step.needMinor, step.capMinor ?? Infinity) > 0);
  const { lines, firstUnmetId: _first, ...totals } = calcAllocation({ availableMinor, steps: wanted.map((step) => ({ ...step, id: `${step.group}:${step.id}` })) });
  return { ...totals, lines: lines.map((line, i) => ({ ...line, group: wanted[i]!.group, id: wanted[i]!.id })) };
}

type Status = Allocation['status'];
const inStatus: Record<Status, SQL | undefined> = {
  proposed: and(isNull(allocations.confirmedAt), isNull(allocations.voidedAt)),
  confirmed: and(isNotNull(allocations.confirmedAt), isNull(allocations.voidedAt)),
  discarded: isNotNull(allocations.voidedAt),
};

interface Filter {
  id?: string;
  month?: string;
  status?: Status;
  limit?: number;
}

/** Newest first. Filtered before it is limited, so that a pile of proposals cannot hide what was confirmed. */
export async function listAllocations(ctx: Ctx, userId: string, { id, month, status, limit }: Filter = {}, exec: Executor = ctx.db): Promise<Allocation[]> {
  const rows = await exec
    .select()
    .from(allocations)
    .where(and(eq(allocations.userId, userId), id ? eq(allocations.id, id) : undefined, month ? eq(allocations.month, month) : undefined, status && inStatus[status]))
    .orderBy(desc(allocations.createdAt))
    .limit(limit ?? 5000);
  if (rows.length === 0) return [];
  const key = await getUserKey(ctx, userId, exec);
  return rows.map((row) => ({
    ...openJson<Stored>(key, aad(userId, row.id), row.data),
    id: row.id,
    month: row.month,
    status: row.voidedAt ? 'discarded' : row.confirmedAt ? 'confirmed' : 'proposed',
    madeBy: row.actorType,
    madeAt: row.createdAt,
  }));
}

/** What has been confirmed in the month of `today`. */
export const sharedOutThisMonth = (ctx: Ctx, userId: string, today: string) => listAllocations(ctx, userId, { month: today.slice(0, 7), status: 'confirmed' });

/** How an amount would be shared out now. Stores nothing. */
export async function previewAllocation(ctx: Ctx, userId: string, availableMinor: number, today: string): Promise<AllocationPlan> {
  // Read first: if anything changes meanwhile, the plan is taken to be out of date, never the reverse.
  const profile = await getProfile(ctx, userId);
  if (!profile) throw new NotFoundError('Profile');
  const [items, goals, earlier] = await Promise.all([listItems(ctx, userId), listGoals(ctx, userId), sharedOutThisMonth(ctx, userId, today)]);
  return { ...shareOut(items, goals, amount.parse(availableMinor), today, earlier), revision: profile.revision };
}

/** More than this many waiting at once is a mistake, not a choice to make. */
const MAX_PROPOSALS = 20;

/** Keeps a proposal for how to share out an amount. No balance changes until the user confirms it. */
export async function proposeAllocation(ctx: Ctx, userId: string, actor: Actor, availableMinor: number, today: string): Promise<Allocation> {
  const plan = await previewAllocation(ctx, userId, availableMinor, today);
  if ((await listAllocations(ctx, userId, { status: 'proposed', limit: MAX_PROPOSALS })).length === MAX_PROPOSALS) {
    throw new ConflictError('Too many proposals are waiting; the user needs to confirm or discard some on the FinPlan website first');
  }
  const key = await getUserKey(ctx, userId);
  const id = crypto.randomUUID();
  const [row] = await ctx.db
    .insert(allocations)
    .values({ id, userId, month: today.slice(0, 7), ...actorColumns(actor), data: sealJson(key, aad(userId, id), plan) })
    .returning();
  return { ...plan, id, month: row!.month, status: 'proposed', madeBy: actor.type, madeAt: row!.createdAt };
}

const moves = (plan: AllocationPlan): Move[] =>
  plan.lines.flatMap((line) =>
    line.allocatedMinor === 0 || (line.group !== 'goal' && line.group !== 'set_aside')
      ? []
      : [{ to: line.group === 'goal' ? ('goal' as const) : ('expense' as const), id: line.id, amountMinor: line.allocatedMinor }],
  );

/**
 * The user says the money moved: goals and set-asides go up by what they were given. Only ever
 * called on behalf of the signed-in user. Refused if the profile, its goals or what has been
 * shared out has changed since it was worked out, because it no longer fits.
 */
export async function confirmAllocation(ctx: Ctx, userId: string, id: string): Promise<void> {
  const [proposal] = await listAllocations(ctx, userId, { id });
  if (!proposal) throw new NotFoundError('Allocation');
  if (proposal.status !== 'proposed') throw new ConflictError('This has already been settled');
  await applyMoves(ctx, userId, moves(proposal), { throughLinks: true, expectedRevision: proposal.revision }, async (tx, key, made) => {
    const { lines, availableMinor, allocatedMinor, leftMinor, revision } = proposal;
    const stored: Stored = { lines, availableMinor, allocatedMinor, leftMinor, revision, made };
    const updated = await tx
      .update(allocations)
      .set({ confirmedAt: sql`now()`, data: sealJson(key, aad(userId, id), stored) })
      .where(and(eq(allocations.id, id), eq(allocations.userId, userId), inStatus.proposed))
      .returning({ id: allocations.id });
    if (updated.length === 0) throw new ConflictError('This has already been settled');
  });
}

/** Takes an allocation back. If it had been confirmed, the balances it raised go down again. Only ever called on behalf of the signed-in user. */
export async function discardAllocation(ctx: Ctx, userId: string, id: string): Promise<void> {
  const [found] = await listAllocations(ctx, userId, { id });
  if (!found || found.status === 'discarded') throw new NotFoundError('Allocation');
  const settle = async (exec: Executor) => {
    const updated = await exec
      .update(allocations)
      .set({ voidedAt: sql`now()` })
      .where(and(eq(allocations.id, id), eq(allocations.userId, userId), inStatus[found.status]))
      .returning({ id: allocations.id });
    if (updated.length === 0) throw new ConflictError('This has already been settled');
  };
  // A proposal changed no balance, so there is nothing to put back.
  if (found.status === 'proposed') return settle(ctx.db);
  const back = (found.made ?? []).map((move) => ({ ...move, amountMinor: -move.amountMinor }));
  await applyMoves(ctx, userId, back, { throughLinks: false }, settle);
}
