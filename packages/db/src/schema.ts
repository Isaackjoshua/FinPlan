import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Accounts. These four tables follow the shape Better Auth expects.
// ---------------------------------------------------------------------------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt,
  updatedAt,
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt,
    updatedAt,
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt,
    updatedAt,
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Encryption keys. One data key per user, wrapped by the master key.
// Deleting this row makes the user's financial data unrecoverable.
// ---------------------------------------------------------------------------

export const userKeys = pgTable('user_keys', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  wrappedKey: text('wrapped_key').notNull(),
  createdAt,
});

// ---------------------------------------------------------------------------
// Financial data. Anything a person would consider private (labels, amounts,
// rates, notes) lives in the encrypted `data` column. Only what the database
// needs for lookups and integrity stays in clear text.
// ---------------------------------------------------------------------------

export const actorType = pgEnum('actor_type', ['user', 'agent']);
export const itemKind = pgEnum('item_kind', ['income', 'expense', 'debt', 'savings']);
export const goalStatus = pgEnum('goal_status', ['active', 'paused', 'achieved', 'abandoned']);

export const profiles = pgTable('profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  country: text('country').notNull(),
  currency: text('currency').notNull(),
  /** Bumped on every change to the profile, its items, or goals. */
  revision: integer('revision').notNull().default(1),
  data: text('data').notNull(),
  createdAt,
  updatedAt,
});

export const profileItems = pgTable(
  'profile_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: itemKind('kind').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    data: text('data').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [index('profile_items_user_idx').on(t.userId, t.kind)],
);

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: goalStatus('status').notNull().default('active'),
    data: text('data').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [index('goals_user_idx').on(t.userId)],
);

/** Snapshot of profile, items and goals taken before each agent write. */
export const profileRevisions = pgTable(
  'profile_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    actorType: actorType('actor_type').notNull(),
    connectionId: uuid('connection_id'),
    data: text('data').notNull(),
    createdAt,
  },
  (t) => [uniqueIndex('profile_revisions_user_rev').on(t.userId, t.revision)],
);

// ---------------------------------------------------------------------------
// Plans. Versions are immutable (enforced by a trigger, see migrations);
// `plans.current_version_id` points at the active one, so undo is a pointer move.
// ---------------------------------------------------------------------------

export const plans = pgTable('plans', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  currentVersionId: uuid('current_version_id'),
  createdAt,
  updatedAt,
});

export const planVersions = pgTable(
  'plan_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    parentVersionId: uuid('parent_version_id'),
    actorType: actorType('actor_type').notNull(),
    connectionId: uuid('connection_id'),
    engineVersion: text('engine_version'),
    data: text('data').notNull(),
    createdAt,
  },
  (t) => [uniqueIndex('plan_versions_user_number').on(t.userId, t.versionNumber)],
);

/** Audit trail of which version was made current, by whom, and why. */
export const planEvents = pgTable(
  'plan_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['saved', 'reverted'] }).notNull(),
    fromVersion: integer('from_version'),
    toVersion: integer('to_version').notNull(),
    actorType: actorType('actor_type').notNull(),
    connectionId: uuid('connection_id'),
    createdAt,
  },
  (t) => [index('plan_events_user_idx').on(t.userId, t.createdAt)],
);

export const checkIns = pgTable(
  'check_ins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    planVersionId: uuid('plan_version_id').references(() => planVersions.id),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    actorType: actorType('actor_type').notNull(),
    connectionId: uuid('connection_id'),
    data: text('data').notNull(),
    createdAt,
  },
  (t) => [index('check_ins_user_idx').on(t.userId, t.periodEnd)],
);

// ---------------------------------------------------------------------------
// Literacy. Lesson content lives in code (packages/core/src/content) and is
// referred to by slug; these tables hold each user's assignments and progress.
// ---------------------------------------------------------------------------

export const lessonAssignments = pgTable(
  'lesson_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lessonSlug: text('lesson_slug').notNull(),
    status: text('status', { enum: ['assigned', 'completed', 'dismissed'] })
      .notNull()
      .default('assigned'),
    actorType: actorType('actor_type').notNull(),
    connectionId: uuid('connection_id'),
    /** Encrypted: the reason an agent gives may describe the user's finances. */
    data: text('data').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex('lesson_assignments_user_lesson').on(t.userId, t.lessonSlug)],
);

export const lessonProgress = pgTable(
  'lesson_progress',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lessonSlug: text('lesson_slug').notNull(),
    status: text('status', { enum: ['started', 'completed'] }).notNull(),
    /** Best quiz result so far, as a percentage. */
    bestScore: integer('best_score'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.lessonSlug] })],
);

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lessonSlug: text('lesson_slug').notNull(),
    correct: integer('correct').notNull(),
    total: integer('total').notNull(),
    /** The option index chosen for each question, in order. */
    answers: jsonb('answers').$type<number[]>().notNull(),
    createdAt,
  },
  (t) => [index('quiz_attempts_user_lesson').on(t.userId, t.lessonSlug, t.createdAt)],
);
