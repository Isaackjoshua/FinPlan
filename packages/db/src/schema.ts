import {
  bigserial,
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

// ---------------------------------------------------------------------------
// Agents. An AI app reaches a user's data only through a connection the user
// approved. Nothing here holds financial values.
// ---------------------------------------------------------------------------

/**
 * Storage for the OAuth server (clients, consent grants, codes, tokens).
 * Access tokens, refresh tokens and codes are keyed by a hash of their value, so
 * a copy of this table cannot be used to call the MCP server.
 */
export const oauthRecords = pgTable(
  'oauth_records',
  {
    model: text('model').notNull(),
    id: text('id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    grantId: text('grant_id'),
    uid: text('uid'),
    userCode: text('user_code'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.model, t.id] }),
    index('oauth_records_grant_idx').on(t.grantId),
    index('oauth_records_uid_idx').on(t.uid),
    index('oauth_records_expires_idx').on(t.expiresAt),
  ],
);

/** One row each time a user approves an AI app. This is what the agents page lists. */
export const agentConnections = pgTable(
  'agent_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    /** As reported by the app itself; shown to the user, never trusted. */
    clientName: text('client_name').notNull(),
    /** The OAuth grant behind this connection; its tokens carry the same id. */
    grantId: text('grant_id').notNull().unique(),
    scopes: text('scopes').array().notNull(),
    createdAt,
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('agent_connections_user_idx').on(t.userId, t.createdAt)],
);

export const activityOutcome = pgEnum('activity_outcome', ['ok', 'denied', 'invalid', 'rate_limited', 'error']);

/** Append-only record of every tool call. Holds names of things, never their values. */
export const agentActivity = pgTable(
  'agent_activity',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => agentConnections.id, { onDelete: 'cascade' }),
    tool: text('tool').notNull(),
    requiredScope: text('required_scope'),
    outcome: activityOutcome('outcome').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    changedFields: text('changed_fields').array(),
    durationMs: integer('duration_ms').notNull(),
    createdAt,
  },
  (t) => [
    index('agent_activity_user_idx').on(t.userId, t.createdAt),
    index('agent_activity_connection_idx').on(t.connectionId, t.createdAt),
  ],
);

/** Lets an agent repeat a write safely: the same key returns the first answer. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => agentConnections.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    tool: text('tool').notNull(),
    /** Hash of the arguments, so a key cannot be reused for a different request. */
    requestHash: text('request_hash').notNull(),
    /** Encrypted: the stored answer may include computed plan figures. Null while in flight. */
    response: text('response'),
    createdAt,
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.key] }), index('idempotency_keys_expires_idx').on(t.expiresAt)],
);

/** Fixed-window counters for rate limits. */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull(),
});
