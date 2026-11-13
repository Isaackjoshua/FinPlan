import {
  checkInVariance,
  getCurrentPlan,
  getLesson,
  getPlanVersion,
  getProfile,
  getProgress,
  GOAL_KINDS,
  GOAL_STATUSES,
  listCheckIns,
  listGoals,
  listItems,
  listLessons,
  listPlanVersions,
  profileWarnings,
  summarise,
  TAGS,
  TOPICS,
  type Ctx,
  type Profile,
} from '@fin/core';
import { z } from 'zod';
import {
  bps,
  category,
  debtKind,
  frequency,
  isoDate,
  minor,
  MINOR_NOTE,
  plan,
  planOut,
  POSITIONING,
  signedMinor,
  toSnake,
  ToolError,
  USER_TEXT_NOTE,
  variance,
  warning,
} from '../wire';
import { tool } from './define';

/** Every tool that touches user data starts here: no profile means onboarding is not finished. */
export async function needProfile(ctx: Ctx, userId: string): Promise<Profile> {
  const profile = await getProfile(ctx, userId);
  if (!profile) {
    throw new ToolError('The user has not finished setting up FinPlan yet. Ask them to sign in to FinPlan and choose their country and currency, then try again.');
  }
  return profile;
}

const label = z.strictObject({ label: z.string() });
const detail = z.enum(['summary', 'full']).default('summary').describe('`summary` gives totals; `full` adds the budget breakdown and the month-by-month debt schedule.');

const getProfileTool = tool({
  name: 'get_profile',
  title: 'Get financial profile',
  kind: 'read',
  scope: 'finance:read',
  description: `Read the user's financial profile. By default returns only monthly totals and warnings; ask for line items with \`sections\`, and request only what you need. Read this before proposing changes, and pass the returned \`revision\` to update_profile. ${MINOR_NOTE} ${USER_TEXT_NOTE}`,
  input: z.strictObject({
    sections: z
      .array(z.enum(['summary', 'income', 'expenses', 'debts', 'savings']))
      .max(5)
      .default(['summary'])
      .describe('Which parts to return. `summary` is totals only; the others are the individual line items.'),
  }),
  output: z.strictObject({
    currency: z.string(),
    country: z.string(),
    revision: z.number().int(),
    summary: z
      .strictObject({
        monthly_income_minor: minor,
        monthly_expenses_minor: minor,
        monthly_essential_expenses_minor: minor,
        monthly_debt_minimums_minor: minor,
        monthly_surplus_minor: signedMinor,
        total_debt_minor: minor,
        total_savings_minor: minor,
        emergency_fund_minor: minor,
        highest_apr_bps: bps.nullable(),
        pay_frequency: frequency.optional(),
        household_size: z.number().int().optional(),
        user_text: z.strictObject({ notes: z.string().optional() }),
        warnings: z.array(warning),
      })
      .optional(),
    income: z.array(z.strictObject({ id: z.string(), amount_minor: minor, frequency, user_text: label })).optional(),
    expenses: z.array(z.strictObject({ id: z.string(), amount_minor: minor, frequency, category, essential: z.boolean(), user_text: label })).optional(),
    debts: z.array(z.strictObject({ id: z.string(), debt_kind: debtKind, balance_minor: minor, apr_bps: bps, minimum_payment_minor: minor, user_text: label })).optional(),
    savings: z.array(z.strictObject({ id: z.string(), balance_minor: minor, apy_bps: bps, is_emergency_fund: z.boolean(), user_text: label })).optional(),
  }),
  async run({ sections }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    const items = await listItems(ctx, auth.userId);
    const wants = (section: (typeof sections)[number]) => sections.includes(section);
    // Line items leave their label out of the main object and carry it in `user_text`.
    const lines = (kind: string) =>
      items.filter((item) => item.kind === kind).map(({ kind: _kind, label: text, ...rest }) => ({ ...toSnake(rest), user_text: { label: text } }));
    const totals = summarise(items);
    return {
      result: {
        currency: profile.currency,
        country: profile.country,
        revision: profile.revision,
        ...(wants('summary') && {
          summary: {
            monthly_income_minor: totals.monthlyIncome,
            monthly_expenses_minor: totals.monthlyExpenses,
            monthly_essential_expenses_minor: totals.monthlyEssentialExpenses,
            monthly_debt_minimums_minor: totals.monthlyDebtMinimums,
            monthly_surplus_minor: totals.monthlySurplus,
            total_debt_minor: totals.totalDebt,
            total_savings_minor: totals.totalSavings,
            emergency_fund_minor: totals.emergencyFund,
            highest_apr_bps: totals.highestAprBps,
            ...(profile.payFrequency && { pay_frequency: profile.payFrequency }),
            ...(profile.householdSize && { household_size: profile.householdSize }),
            user_text: profile.notes ? { notes: profile.notes } : {},
            warnings: profileWarnings(totals),
          },
        }),
        ...(wants('income') && { income: lines('income') }),
        ...(wants('expenses') && { expenses: lines('expense') }),
        ...(wants('debts') && { debts: lines('debt') }),
        ...(wants('savings') && { savings: lines('savings') }),
      },
    };
  },
});

const listGoalsTool = tool({
  name: 'list_goals',
  title: 'List goals',
  kind: 'read',
  scope: 'finance:read',
  description: `List the user's financial goals with their targets and progress. ${MINOR_NOTE} ${USER_TEXT_NOTE}`,
  input: z.strictObject({ status: z.enum(GOAL_STATUSES).optional().describe('Only goals with this status. Omit for all.') }),
  output: z.strictObject({
    currency: z.string(),
    goals: z.array(
      z.strictObject({
        id: z.string(),
        kind: z.enum(GOAL_KINDS),
        status: z.enum(GOAL_STATUSES),
        priority: z.number().int(),
        target_amount_minor: minor,
        current_amount_minor: minor,
        target_date: z.string().nullable(),
        user_text: z.strictObject({ title: z.string() }),
      }),
    ),
  }),
  async run({ status }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    const goals = (await listGoals(ctx, auth.userId)).filter((goal) => !status || goal.status === status);
    return {
      result: {
        currency: profile.currency,
        goals: goals.map((goal) => ({
          id: goal.id,
          kind: goal.kind,
          status: goal.status,
          priority: goal.priority,
          target_amount_minor: goal.targetAmountMinor,
          current_amount_minor: goal.currentAmountMinor,
          target_date: goal.targetDate ?? null,
          user_text: { title: goal.title },
        })),
      },
    };
  },
});

const planOutput = z.strictObject({ currency: z.string(), plan: plan.nullable() });

const getCurrentPlanTool = tool({
  name: 'get_current_plan',
  title: 'Get current plan',
  kind: 'read',
  scope: 'finance:read',
  description: `Read the plan the user is currently following: the choices in it and the figures the platform computed from them. \`plan\` is null if no plan has been saved yet. ${MINOR_NOTE} ${USER_TEXT_NOTE} ${POSITIONING}`,
  input: z.strictObject({ detail }),
  output: planOutput,
  async run({ detail: level }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    const current = await getCurrentPlan(ctx, auth.userId);
    return { result: { currency: profile.currency, plan: current ? planOut(current, level) : null } };
  },
});

const getPlanVersionTool = tool({
  name: 'get_plan_version',
  title: 'Get a plan version',
  kind: 'read',
  scope: 'finance:read',
  description: `Read one saved version of the plan by its number, for example to compare it with the current one. ${MINOR_NOTE} ${USER_TEXT_NOTE} ${POSITIONING}`,
  input: z.strictObject({ version: z.number().int().positive(), detail }),
  output: planOutput,
  async run({ version, detail: level }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    return { result: { currency: profile.currency, plan: planOut(await getPlanVersion(ctx, auth.userId, version), level) } };
  },
});

const listPlanVersionsTool = tool({
  name: 'list_plan_versions',
  title: 'List plan versions',
  kind: 'read',
  scope: 'finance:read',
  description: `List the plan's history, newest first: version number, when and by whom it was saved, and its summary. Every save creates a new version; nothing is overwritten. Only the user can make an older version current again, from the FinPlan website. ${USER_TEXT_NOTE} ${POSITIONING}`,
  input: z.strictObject({
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().regex(/^\d{1,9}$/).optional().describe('`next_cursor` from the previous page.'),
  }),
  output: z.strictObject({
    versions: z.array(
      z.strictObject({
        version: z.number().int(),
        saved_at: z.string(),
        saved_by: z.enum(['user', 'agent']),
        is_current: z.boolean(),
        user_text: z.strictObject({ summary: z.string() }),
      }),
    ),
    next_cursor: z.string().nullable(),
  }),
  async run({ limit, cursor }, auth, { ctx }) {
    const before = cursor ? Number(cursor) : Infinity;
    const older = (await listPlanVersions(ctx, auth.userId)).filter((v) => v.version < before);
    const page = older.slice(0, limit);
    return {
      result: {
        versions: page.map((v) => ({
          version: v.version,
          saved_at: v.savedAt.toISOString(),
          saved_by: v.savedBy,
          is_current: v.isCurrent,
          user_text: { summary: v.summary },
        })),
        next_cursor: older.length > limit ? String(page.at(-1)!.version) : null,
      },
    };
  },
});

const listCheckInsTool = tool({
  name: 'list_check_ins',
  title: 'List check-ins',
  kind: 'read',
  scope: 'finance:read',
  description: `List the user's check-ins, newest first: what they actually earned, spent, paid towards debt and saved in a period, and how that compares with the plan that was current then. In \`variance\`, planned monthly figures are scaled to the length of the period, and a positive difference means more than planned. ${MINOR_NOTE} ${USER_TEXT_NOTE}`,
  input: z.strictObject({
    since: isoDate.optional().describe('Only check-ins whose period ends on or after this date.'),
    limit: z.number().int().min(1).max(50).default(12),
  }),
  output: z.strictObject({
    currency: z.string(),
    check_ins: z.array(
      z.strictObject({
        id: z.string(),
        period_start: z.string(),
        period_end: z.string(),
        logged_at: z.string(),
        logged_by: z.enum(['user', 'agent']),
        actuals: z.strictObject({
          income_minor: minor,
          spending: z.array(z.strictObject({ category, amount_minor: minor })),
          debt_payments_minor: minor,
          savings_added_minor: minor,
        }),
        variance: variance.nullable(),
        user_text: z.strictObject({ note: z.string().optional() }),
      }),
    ),
  }),
  async run({ since, limit }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    const all = await listCheckIns(ctx, auth.userId, 120);
    const page = all.filter((c) => !since || c.periodEnd >= since).slice(0, limit);
    const versions = page.some((c) => c.planVersionId) ? await listPlanVersions(ctx, auth.userId) : [];
    return {
      result: {
        currency: profile.currency,
        check_ins: page.map((c) => {
          const planThen = versions.find((v) => v.id === c.planVersionId);
          return {
            id: c.id,
            period_start: c.periodStart,
            period_end: c.periodEnd,
            logged_at: c.loggedAt.toISOString(),
            logged_by: c.loggedBy,
            actuals: toSnake(c.actuals),
            variance: planThen ? toSnake(checkInVariance(c, planThen)) : null,
            user_text: c.note ? { note: c.note } : {},
          };
        }),
      },
    };
  },
});

const getProgressTool = tool({
  name: 'get_progress',
  title: 'Get progress',
  kind: 'read',
  scope: 'finance:read',
  description: `A compact picture of how the user is getting on: progress towards each goal, current debt and savings, plan and check-in history, and lessons assigned and completed. Use this for a quick status before reading anything in detail. ${MINOR_NOTE}`,
  input: z.strictObject({}),
  output: z.strictObject({
    currency: z.string(),
    goals: z.array(z.strictObject({ id: z.string(), status: z.string(), percent: z.number().int(), remaining_minor: minor })),
    total_debt_minor: minor,
    total_savings_minor: minor,
    emergency_fund_minor: minor,
    plan: z.strictObject({ versions: z.number().int(), current_version: z.number().int().nullable(), last_saved_at: z.string().nullable() }),
    check_ins: z.strictObject({
      count: z.number().int(),
      last_period_end: z.string().nullable(),
      debt_payments_logged_minor: minor,
      savings_added_logged_minor: minor,
    }),
    lessons: z.strictObject({
      assigned: z.number().int(),
      completed: z.number().int(),
      quizzes: z.array(z.strictObject({ slug: z.string(), best_score: z.number().int() })),
    }),
  }),
  async run(_args, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    return { result: { ...toSnake(await getProgress(ctx, auth.userId)), currency: profile.currency } };
  },
});

// --- Lesson catalogue: our own content, the same for everyone -----------------------

const lessonCard = {
  slug: z.string(),
  title: z.string(),
  topic: z.enum(TOPICS),
  difficulty: z.number().int().describe('1 = no background needed, 3 = more involved.'),
  minutes: z.number().int(),
  tags: z.array(z.string()),
};

const listLessonsTool = tool({
  name: 'list_lessons',
  title: 'List lessons',
  kind: 'catalogue',
  scope: null,
  description: 'Browse the short financial-literacy lessons available on FinPlan, optionally filtered. Use the `slug` with get_lesson or assign_lessons.',
  input: z.strictObject({
    topic: z.enum(TOPICS).optional(),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    tag: z.enum(TAGS).optional(),
  }),
  output: z.strictObject({ lessons: z.array(z.strictObject(lessonCard)) }),
  async run(filter) {
    return {
      result: {
        lessons: listLessons(filter).map((l) => ({ slug: l.slug, title: l.title, topic: l.topic, difficulty: l.difficulty, minutes: l.minutes, tags: l.tags })),
      },
    };
  },
});

const getLessonTool = tool({
  name: 'get_lesson',
  title: 'Get lesson details',
  kind: 'catalogue',
  scope: null,
  description: 'What one lesson covers: its summary, learning objectives and quiz length, with a link. The full lesson and its quiz are read by the user on FinPlan, where their progress is recorded; do not attempt to reproduce the lesson.',
  input: z.strictObject({ slug: z.string().max(80) }),
  output: z.strictObject({ ...lessonCard, summary: z.string(), objectives: z.array(z.string()), quiz_question_count: z.number().int(), url: z.string() }),
  async run({ slug }, _auth, { appUrl }) {
    const l = getLesson(slug);
    return {
      result: {
        slug: l.slug,
        title: l.title,
        topic: l.topic,
        difficulty: l.difficulty,
        minutes: l.minutes,
        tags: l.tags,
        summary: l.summary,
        objectives: l.objectives,
        quiz_question_count: l.quiz.length,
        url: `${appUrl}/lessons/${l.slug}`,
      },
    };
  },
});

export const readTools = [
  getProfileTool,
  listGoalsTool,
  getCurrentPlanTool,
  listPlanVersionsTool,
  getPlanVersionTool,
  listCheckInsTool,
  getProgressTool,
  listLessonsTool,
  getLessonTool,
];
