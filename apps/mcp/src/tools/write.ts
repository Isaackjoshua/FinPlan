import {
  applyProfileChanges,
  assignLessons,
  checkInInput,
  checkInVariance,
  createGoal,
  getCurrentPlan,
  GOAL_KINDS,
  GOAL_STATUSES,
  listItems,
  logCheckIn,
  profileWarnings,
  savePlanVersion,
  summarise,
  updateGoal,
  type Actor,
} from '@fin/core';
import { z } from 'zod';
import {
  bps,
  category,
  debtKind,
  frequency,
  IDEMPOTENCY_NOTE,
  idempotencyKey,
  isoDate,
  minor,
  MINOR_NOTE,
  planResults,
  POSITIONING,
  resultsOut,
  toCamel,
  ToolError,
  toSnake,
  USER_TEXT_NOTE,
  variance,
  warning,
} from '../wire';
import { tool, type ToolAuth } from './define';
import { needProfile } from './read';

const agent = (auth: ToolAuth): Actor => ({ type: 'agent', connectionId: auth.connectionId });
const UNDO_NOTE = 'The user sees every change you make, marked as made by an agent, and can undo it from the FinPlan website.';
const label = z.string().min(1).max(80).describe('Short name shown to the user, e.g. "Salary" or "Rent".');

const item = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('income'), label, amount_minor: minor, frequency }),
  z.strictObject({ kind: z.literal('expense'), label, amount_minor: minor, frequency, category, essential: z.boolean().describe('True for needs (housing, food, utilities…), false for wants.') }),
  z.strictObject({ kind: z.literal('debt'), label, debt_kind: debtKind, balance_minor: minor, apr_bps: bps.describe('Annual interest rate in basis points: 1999 = 19.99%.'), minimum_payment_minor: minor.describe('Minimum payment per month.') }),
  z.strictObject({ kind: z.literal('savings'), label, balance_minor: minor, apy_bps: bps, is_emergency_fund: z.boolean() }),
]);

const updateProfileTool = tool({
  name: 'update_profile',
  title: 'Update financial profile',
  kind: 'write',
  scope: 'finance:write',
  description: `Change the user's profile: add or replace income sources, expenses, debts and savings accounts, hide ones that no longer apply, and set household details. All changes in one call are applied together or not at all. Only record figures the user has told you; do not guess. Requires the \`revision\` you got from get_profile, so that you cannot overwrite a change made since you last read it. Nothing is deleted: "archive" hides an item. ${UNDO_NOTE} ${MINOR_NOTE} ${IDEMPOTENCY_NOTE}`,
  input: z.strictObject({
    expected_revision: z.number().int().positive().describe('The `revision` from your most recent get_profile.'),
    details: z
      .strictObject({ pay_frequency: frequency.optional(), household_size: z.number().int().min(1).max(30).optional(), notes: z.string().max(2000).optional() })
      .optional()
      .describe('Household details. Only the fields you include are changed.'),
    items: z
      .array(
        z.discriminatedUnion('op', [
          z.strictObject({ op: z.literal('upsert'), id: z.uuid().optional().describe('Omit to create; give an existing id to replace that item.'), item }),
          z.strictObject({ op: z.literal('archive'), id: z.uuid() }),
        ]),
      )
      .max(30)
      .optional(),
    idempotency_key: idempotencyKey,
  }),
  output: z.strictObject({
    revision: z.number().int(),
    created: z.array(z.strictObject({ id: z.string(), kind: z.string() })),
    updated: z.array(z.string()),
    archived: z.array(z.string()),
    details_changed: z.array(z.string()),
    warnings: z.array(warning).describe('Things in the resulting profile worth raising with the user.'),
  }),
  async run({ expected_revision, details, items }, auth, { ctx }) {
    await needProfile(ctx, auth.userId);
    if (!details && !items?.length) throw new ToolError('Nothing to change: give `details`, `items`, or both.');
    const { revision, result } = await applyProfileChanges(
      ctx,
      auth.userId,
      agent(auth),
      { details: toCamel(details), changes: toCamel(items) },
      { expectedRevision: expected_revision },
    );
    const detailsChanged = result.details.map((name) => toSnake<Record<string, true>>({ [name]: true })).flatMap(Object.keys);
    return {
      result: {
        revision,
        created: result.created,
        updated: result.updated,
        archived: result.archived,
        details_changed: detailsChanged,
        warnings: profileWarnings(summarise(await listItems(ctx, auth.userId))),
      },
      touched: {
        entityType: 'profile',
        entityId: String(revision),
        changedFields: [
          ...detailsChanged.map((name) => `details.${name}`),
          ...result.created.map((c) => `${c.kind}.created`),
          ...(result.updated.length ? ['items.updated'] : []),
          ...(result.archived.length ? ['items.archived'] : []),
        ],
      },
    };
  },
});

const goalFields = {
  title: z.string().min(1).max(120),
  target_amount_minor: minor,
  current_amount_minor: minor.describe('How much has been put towards the goal so far.'),
  target_date: isoDate,
  priority: z.number().int().min(1).max(5).describe('1 is most important, 5 least.'),
};

const createGoalTool = tool({
  name: 'create_goal',
  title: 'Create a goal',
  kind: 'write',
  scope: 'finance:write',
  description: `Add a financial goal the user has told you about, such as building an emergency fund or clearing a debt. ${UNDO_NOTE} ${MINOR_NOTE} ${IDEMPOTENCY_NOTE} ${POSITIONING}`,
  input: z.strictObject({
    kind: z.enum(GOAL_KINDS),
    title: goalFields.title,
    target_amount_minor: goalFields.target_amount_minor,
    current_amount_minor: goalFields.current_amount_minor.optional(),
    target_date: goalFields.target_date.optional(),
    priority: goalFields.priority.optional(),
    idempotency_key: idempotencyKey,
  }),
  output: z.strictObject({ goal_id: z.string(), revision: z.number().int() }),
  async run({ idempotency_key: _key, ...fields }, auth, { ctx }) {
    await needProfile(ctx, auth.userId);
    const { revision, result: goalId } = await createGoal(ctx, auth.userId, agent(auth), toCamel(fields));
    return { result: { goal_id: goalId, revision }, touched: { entityType: 'goal', entityId: goalId, changedFields: Object.keys(fields) } };
  },
});

const updateGoalTool = tool({
  name: 'update_goal',
  title: 'Update a goal',
  kind: 'write',
  scope: 'finance:write',
  description: `Change a goal: its progress, target, date, priority, wording or status. Only the fields you include are changed. Goals are never deleted; set \`status\` to "abandoned" or "achieved" instead. ${UNDO_NOTE} ${MINOR_NOTE} ${IDEMPOTENCY_NOTE}`,
  input: z.strictObject({
    goal_id: z.uuid(),
    title: goalFields.title.optional(),
    target_amount_minor: goalFields.target_amount_minor.optional(),
    current_amount_minor: goalFields.current_amount_minor.optional(),
    target_date: goalFields.target_date.optional(),
    priority: goalFields.priority.optional(),
    status: z.enum(GOAL_STATUSES).optional(),
    idempotency_key: idempotencyKey,
  }),
  output: z.strictObject({ goal_id: z.string(), changed_fields: z.array(z.string()), revision: z.number().int() }),
  async run({ goal_id, idempotency_key: _key, ...changes }, auth, { ctx }) {
    await needProfile(ctx, auth.userId);
    const changed = Object.keys(changes);
    if (changed.length === 0) throw new ToolError('Nothing to change: include at least one field besides `goal_id`.');
    const { revision } = await updateGoal(ctx, auth.userId, agent(auth), goal_id, toCamel(changes));
    return { result: { goal_id, changed_fields: changed, revision }, touched: { entityType: 'goal', entityId: goal_id, changedFields: changed } };
  },
});

const savePlanVersionTool = tool({
  name: 'save_plan_version',
  title: 'Save a new plan version',
  kind: 'write',
  scope: 'finance:write',
  description: `Save a new version of the user's plan and make it the current one. You supply the choices (a monthly budget per category, a debt strategy, contributions to goals); the platform computes every figure itself from the saved profile and returns them. Totals or projections you calculate are not accepted, so use the calc_* tools to explore options first. Earlier versions are kept unchanged and only the user can switch back to one. Agree the plan with the user before saving it. ${UNDO_NOTE} ${MINOR_NOTE} ${IDEMPOTENCY_NOTE} ${POSITIONING}`,
  input: z.strictObject({
    summary: z.string().min(1).max(1000).describe('A short plain-language description of this plan and what changed, for the user to read later.'),
    budget: z.array(z.strictObject({ category, amount_minor: minor })).max(20).describe('Planned monthly spending per category.'),
    debt_strategy: z.enum(['snowball', 'avalanche']).optional().describe('snowball: smallest balance first. avalanche: highest interest rate first.'),
    extra_debt_payment_minor: minor.optional().describe('Monthly amount towards debt on top of the minimum payments.'),
    emergency_fund_months: z.number().int().min(0).max(24).optional().describe('How many months of essential spending the emergency fund should cover (default 3).'),
    goal_contributions: z.array(z.strictObject({ goal_id: z.uuid(), amount_minor: minor })).max(20).optional().describe('Monthly amount towards each goal.'),
    base_version: z.number().int().positive().optional().describe('The version you based this on. If given, the save is refused when the current version is a different one.'),
    idempotency_key: idempotencyKey,
  }),
  output: z.strictObject({ version: z.number().int(), currency: z.string(), results: planResults }),
  async run({ summary, base_version, idempotency_key: _key, ...inputs }, auth, { ctx }) {
    const profile = await needProfile(ctx, auth.userId);
    const { version, results } = await savePlanVersion(ctx, auth.userId, agent(auth), { summary, inputs: toCamel(inputs), baseVersion: base_version });
    return {
      result: { version, currency: profile.currency, results: resultsOut(results, 'summary')! },
      touched: { entityType: 'plan_version', entityId: String(version), changedFields: Object.keys(inputs) },
    };
  },
});

const logCheckInTool = tool({
  name: 'log_check_in',
  title: 'Log a check-in',
  kind: 'write',
  scope: 'finance:write',
  description: `Record what actually happened over a period (a week, a fortnight, a month): income received, spending per category, debt payments and savings added, as reported by the user. Returns how that compares with the current plan, scaled to the length of the period; a positive difference means more than planned. ${UNDO_NOTE} ${MINOR_NOTE} ${IDEMPOTENCY_NOTE} ${USER_TEXT_NOTE}`,
  input: z.strictObject({
    period_start: isoDate,
    period_end: isoDate,
    actuals: z.strictObject({
      income_minor: minor,
      spending: z.array(z.strictObject({ category, amount_minor: minor })).max(20),
      debt_payments_minor: minor.optional(),
      savings_added_minor: minor.optional(),
    }),
    note: z.string().max(1000).optional().describe('Anything the user wants remembered about this period.'),
    idempotency_key: idempotencyKey,
  }),
  output: z.strictObject({ check_in_id: z.string(), variance: variance.nullable().describe('Null when there is no plan to compare with.') }),
  async run({ idempotency_key: _key, ...fields }, auth, { ctx }) {
    await needProfile(ctx, auth.userId);
    const input = checkInInput.parse(toCamel(fields));
    const { id } = await logCheckIn(ctx, auth.userId, agent(auth), input);
    const current = await getCurrentPlan(ctx, auth.userId);
    return {
      result: { check_in_id: id, variance: current ? toSnake(checkInVariance(input, current)) : null },
      touched: { entityType: 'check_in', entityId: id },
    };
  },
});

const assignLessonsTool = tool({
  name: 'assign_lessons',
  title: 'Suggest lessons',
  kind: 'write',
  scope: 'finance:write',
  description: `Put up to five lessons on the user's reading list, with a reason they will see. Choose lessons relevant to their situation (find them with list_lessons). Lessons they have completed, already been given, or dismissed are skipped and reported back; do not re-suggest a dismissed lesson. ${IDEMPOTENCY_NOTE}`,
  input: z.strictObject({
    lesson_slugs: z.array(z.string().max(80)).min(1).max(5),
    reason: z.string().min(1).max(500).describe('One or two sentences, addressed to the user, on why these lessons are relevant.'),
    idempotency_key: idempotencyKey,
  }),
  output: z.strictObject({
    assigned: z.array(z.string()),
    skipped: z.array(z.strictObject({ slug: z.string(), why: z.enum(['unknown_lesson', 'already_assigned', 'already_completed', 'dismissed_by_user']) })),
  }),
  async run({ lesson_slugs, reason }, auth, { ctx }) {
    await needProfile(ctx, auth.userId);
    const result = await assignLessons(ctx, auth.userId, agent(auth), { lessonSlugs: lesson_slugs, reason });
    return { result, touched: { entityType: 'lesson_assignment', changedFields: result.assigned } };
  },
});

export const writeTools = [updateProfileTool, createGoalTool, updateGoalTool, savePlanVersionTool, logCheckInTool, assignLessonsTool];
