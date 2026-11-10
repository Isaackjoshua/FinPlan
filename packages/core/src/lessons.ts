import { and, desc, eq, schema, sql } from '@fin/db';
import { z } from 'zod';
import { LESSONS, TAGS, TOPICS, type Lesson, type Tag } from './content';
import { actorColumns, getUserKey, NotFoundError, type Actor, type Ctx } from './context';
import { openJson, sealJson } from './crypto';
import { text } from './schemas';
import type { Summary } from './summary';
import type { Warning } from './warnings';

const { lessonAssignments, lessonProgress, quizAttempts } = schema;
const bySlug = new Map(LESSONS.map((lesson) => [lesson.slug, lesson]));

// --- Catalogue (no user data involved) --------------------------------------

export const lessonFilter = z.object({
  topic: z.enum(TOPICS).optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  tag: z.enum(TAGS).optional(),
});

export function listLessons(filter: z.input<typeof lessonFilter> = {}): Lesson[] {
  const { topic, difficulty, tag } = lessonFilter.parse(filter);
  return LESSONS.filter(
    (l) => (!topic || l.topic === topic) && (!difficulty || l.difficulty === difficulty) && (!tag || l.tags.includes(tag)),
  );
}

export function getLesson(slug: string): Lesson {
  const lesson = bySlug.get(slug);
  if (!lesson) throw new NotFoundError('Lesson');
  return lesson;
}

/** A quiz is passed with at least two thirds of the questions right. */
export const isPass = (correct: number, total: number) => correct * 3 >= total * 2;

/**
 * Picks up to three lessons that fit the user's situation and that they have not
 * completed. This is the platform's own, rule-based suggestion; an agent can assign
 * lessons on top of it.
 */
export function recommendLessons(summary: Summary, warnings: Warning[], completed: ReadonlySet<string>): Lesson[] {
  const codes = new Set(warnings.map((w) => w.code));
  // Most pressing first: a lesson matching an earlier tag outranks one matching a later tag.
  const wanted: Tag[] = [];
  if (summary.monthlyIncome === 0) wanted.push('getting-started');
  if (codes.has('spending_exceeds_income')) wanted.push('overspending');
  if (codes.has('high_interest_debt')) wanted.push('high-interest-debt');
  if (summary.totalDebt > 0) wanted.push('debt');
  if (codes.has('low_emergency_fund')) wanted.push('emergency-fund');
  wanted.push('goals', 'saving');

  const score = (lesson: Lesson) => wanted.reduce((sum, tag, i) => sum + (lesson.tags.includes(tag) ? 2 ** (wanted.length - i) : 0), 0);
  return LESSONS.filter((l) => !completed.has(l.slug) && score(l) > 0)
    .sort((a, b) => score(b) - score(a) || a.difficulty - b.difficulty)
    .slice(0, 3);
}

// --- Per-user state -----------------------------------------------------------

export interface LessonState {
  status: 'not_started' | 'started' | 'completed';
  /** Best quiz result so far, as a percentage. */
  bestScore: number | null;
  assignment: { status: 'assigned' | 'completed' | 'dismissed'; by: 'user' | 'agent'; reason: string; assignedAt: Date } | null;
}

const aad = (userId: string, id: string) => `lesson_assignments:${userId}:${id}`;
const NOT_STARTED: LessonState = { status: 'not_started', bestScore: null, assignment: null };

/** Progress and assignment for every lesson the user has touched or been given. */
export async function getLessonStates(ctx: Ctx, userId: string): Promise<Map<string, LessonState>> {
  const [progress, assignments] = await Promise.all([
    ctx.db.select().from(lessonProgress).where(eq(lessonProgress.userId, userId)),
    ctx.db.select().from(lessonAssignments).where(eq(lessonAssignments.userId, userId)),
  ]);
  const states = new Map<string, LessonState>();
  for (const row of progress) states.set(row.lessonSlug, { status: row.status, bestScore: row.bestScore, assignment: null });
  if (assignments.length > 0) {
    const key = await getUserKey(ctx, userId);
    for (const row of assignments) {
      const { reason } = openJson<{ reason: string }>(key, aad(userId, row.id), row.data);
      states.set(row.lessonSlug, {
        ...(states.get(row.lessonSlug) ?? NOT_STARTED),
        assignment: { status: row.status, by: row.actorType, reason, assignedAt: row.createdAt },
      });
    }
  }
  return states;
}

export const assignLessonsInput = z.object({
  lessonSlugs: z.array(z.string()).min(1).max(5),
  reason: text(500),
});

export interface AssignResult {
  assigned: string[];
  skipped: { slug: string; why: 'unknown_lesson' | 'already_assigned' | 'already_completed' | 'dismissed_by_user' }[];
}

/**
 * Puts lessons on the user's list. A lesson the user has finished or has dismissed
 * is left alone, so an agent cannot keep pushing something the user declined.
 */
export async function assignLessons(ctx: Ctx, userId: string, actor: Actor, input: z.input<typeof assignLessonsInput>): Promise<AssignResult> {
  const { lessonSlugs, reason } = assignLessonsInput.parse(input);
  const states = await getLessonStates(ctx, userId);
  const key = await getUserKey(ctx, userId);
  const result: AssignResult = { assigned: [], skipped: [] };

  for (const slug of new Set(lessonSlugs)) {
    const state = states.get(slug);
    if (!bySlug.has(slug)) result.skipped.push({ slug, why: 'unknown_lesson' });
    else if (state?.status === 'completed') result.skipped.push({ slug, why: 'already_completed' });
    else if (state?.assignment?.status === 'dismissed') result.skipped.push({ slug, why: 'dismissed_by_user' });
    else if (state?.assignment) result.skipped.push({ slug, why: 'already_assigned' });
    else {
      const id = crypto.randomUUID();
      const inserted = await ctx.db
        .insert(lessonAssignments)
        .values({ id, userId, lessonSlug: slug, ...actorColumns(actor), data: sealJson(key, aad(userId, id), { reason }) })
        .onConflictDoNothing()
        .returning({ id: lessonAssignments.id });
      if (inserted.length > 0) result.assigned.push(slug);
      else result.skipped.push({ slug, why: 'already_assigned' });
    }
  }
  return result;
}

/** The user declines an assigned lesson. It stays in the catalogue and can still be read. */
export async function dismissAssignment(ctx: Ctx, userId: string, slug: string): Promise<void> {
  const updated = await ctx.db
    .update(lessonAssignments)
    .set({ status: 'dismissed' })
    .where(and(eq(lessonAssignments.userId, userId), eq(lessonAssignments.lessonSlug, slug), eq(lessonAssignments.status, 'assigned')))
    .returning({ id: lessonAssignments.id });
  if (updated.length === 0) throw new NotFoundError('Assignment');
}

/** Records that the user opened a lesson. Safe to call on every visit. */
export async function startLesson(ctx: Ctx, userId: string, slug: string): Promise<void> {
  getLesson(slug);
  await ctx.db.insert(lessonProgress).values({ userId, lessonSlug: slug, status: 'started' }).onConflictDoNothing();
}

export interface QuizOutcome {
  attemptId: string;
  correct: number;
  total: number;
  passed: boolean;
}

/** Marks a quiz. Passing completes the lesson and any assignment of it. */
export async function submitQuiz(ctx: Ctx, userId: string, slug: string, answers: number[]): Promise<QuizOutcome> {
  const lesson = getLesson(slug);
  const total = lesson.quiz.length;
  const chosen = z.array(z.number().int().min(0).max(9)).length(total).parse(answers);
  const correct = lesson.quiz.filter((q, i) => q.correctIndex === chosen[i]).length;
  const passed = isPass(correct, total);
  const score = Math.round((correct * 100) / total);

  return ctx.db.transaction(async (tx) => {
    const [attempt] = await tx.insert(quizAttempts).values({ userId, lessonSlug: slug, correct, total, answers: chosen }).returning({ id: quizAttempts.id });
    await tx
      .insert(lessonProgress)
      .values({ userId, lessonSlug: slug, status: passed ? 'completed' : 'started', bestScore: score, completedAt: passed ? new Date() : null })
      .onConflictDoUpdate({
        target: [lessonProgress.userId, lessonProgress.lessonSlug],
        set: {
          // A later failed attempt never un-completes a lesson or lowers the best score.
          bestScore: sql`greatest(coalesce(${lessonProgress.bestScore}, 0), ${score})`,
          ...(passed ? { status: 'completed' as const, completedAt: sql`coalesce(${lessonProgress.completedAt}, now())` } : {}),
        },
      });
    if (passed) {
      await tx
        .update(lessonAssignments)
        .set({ status: 'completed' })
        .where(and(eq(lessonAssignments.userId, userId), eq(lessonAssignments.lessonSlug, slug), eq(lessonAssignments.status, 'assigned')));
    }
    return { attemptId: attempt!.id, correct, total, passed };
  });
}

/** The user's most recent attempt at a lesson's quiz, for showing feedback. */
export async function getLatestAttempt(ctx: Ctx, userId: string, slug: string) {
  const [row] = await ctx.db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.lessonSlug, slug)))
    .orderBy(desc(quizAttempts.createdAt))
    .limit(1);
  return row ? { correct: row.correct, total: row.total, answers: row.answers, passed: isPass(row.correct, row.total), at: row.createdAt } : null;
}
