import { calcDebtPayoff, calcEmergencyFund, calcSavingsProjection, compareDebtStrategies, type DebtPayoffPlan } from '@fin/calc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assignLessons,
  dismissAssignment,
  getLatestAttempt,
  getLesson,
  getLessonStates,
  LESSONS,
  listLessons,
  NotFoundError,
  profileWarnings,
  recommendLessons,
  startLesson,
  submitQuiz,
  TAGS,
  TOPICS,
  USER,
  type Actor,
  type Summary,
} from '../src';
import { createUser, testCtx } from './helpers';

const lessonText = (slug: string) => JSON.stringify(getLesson(slug).body);

describe('lesson catalogue', () => {
  it('is well formed', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(LESSONS.map((l) => l.slug)).size).toBe(LESSONS.length);
    for (const lesson of LESSONS) {
      expect(lesson.slug, lesson.slug).toMatch(/^[a-z0-9-]+$/);
      expect(TOPICS, lesson.slug).toContain(lesson.topic);
      expect(lesson.tags.length, lesson.slug).toBeGreaterThan(0);
      for (const tag of lesson.tags) expect(TAGS, lesson.slug).toContain(tag);
      expect(lesson.objectives.length, lesson.slug).toBeGreaterThanOrEqual(2);
      expect(lesson.body.at(-1)!.type, lesson.slug).toBe('takeaway');
      expect(lesson.quiz.length, lesson.slug).toBeGreaterThanOrEqual(3);
      for (const q of lesson.quiz) {
        expect(q.options.length, q.prompt).toBeGreaterThanOrEqual(3);
        expect(new Set(q.options).size, q.prompt).toBe(q.options.length);
        expect(q.correctIndex, q.prompt).toBeGreaterThanOrEqual(0);
        expect(q.correctIndex, q.prompt).toBeLessThan(q.options.length);
        expect(q.explanation.length, q.prompt).toBeGreaterThan(10);
      }
    }
  });

  it('covers every topic and every difficulty', () => {
    for (const topic of TOPICS) expect(listLessons({ topic }).length, topic).toBeGreaterThan(0);
    for (const difficulty of [1, 2, 3] as const) expect(listLessons({ difficulty }).length).toBeGreaterThan(0);
    for (const tag of TAGS) expect(listLessons({ tag }).length, tag).toBeGreaterThan(0);
  });

  it('filters, and rejects unknown filters and slugs', () => {
    expect(listLessons({ topic: 'debt', difficulty: 3 }).map((l) => l.slug)).toEqual(['comparing-loans']);
    expect(() => listLessons({ topic: 'crypto' as never })).toThrow();
    expect(() => getLesson('nope')).toThrow(NotFoundError);
  });

  it('never mentions specific investments', () => {
    const all = JSON.stringify(LESSONS).toLowerCase();
    for (const word of ['stock', 'shares', 'crypto', 'bitcoin', 'forex', 'etf', 'mutual fund']) expect(all).not.toContain(word);
  });
});

// Every figure a lesson quotes is one the calculation engine produces. If a formula
// changes, these fail and the lesson text has to be brought back in line.
describe('lesson figures match the calculation engine', () => {
  const startDate = '2026-01';
  const single = (pay: number) =>
    calcDebtPayoff({ debts: [{ id: 'a', balanceMinor: 10_000_000, aprBps: 2400, minimumPaymentMinor: 0 }], monthlyBudgetMinor: pay, strategy: 'avalanche', startDate });
  const approx = (minor: number, rounding: number) => (Math.round(minor / 100 / rounding) * rounding).toLocaleString('en');

  it('minimum-payment-trap', () => {
    const text = lessonText('minimum-payment-trap');
    const slow = single(300_000) as DebtPayoffPlan;
    const fast = single(600_000) as DebtPayoffPlan;
    expect(single(200_000).feasible).toBe(false);
    expect(text).toContain(`cleared in ${slow.monthsToDebtFree} months, with about ${approx(slow.totalInterestMinor, 100)}`);
    expect(text).toContain(`cleared in ${fast.monthsToDebtFree} months, with about ${approx(fast.totalInterestMinor, 100)}`);
    expect(text).toContain(`saved about ${approx(slow.totalInterestMinor - fast.totalInterestMinor, 100)}`);
  });

  it('snowball-vs-avalanche', () => {
    const text = lessonText('snowball-vs-avalanche');
    const r = compareDebtStrategies({
      debts: [
        { id: 'A', balanceMinor: 2_000_000, aprBps: 1000, minimumPaymentMinor: 100_000 },
        { id: 'B', balanceMinor: 8_000_000, aprBps: 3000, minimumPaymentMinor: 250_000 },
      ],
      monthlyBudgetMinor: 1_000_000,
      startDate,
    });
    const snowball = r.snowball as DebtPayoffPlan;
    const avalanche = r.avalanche as DebtPayoffPlan;
    expect(text).toContain(`Snowball clears A in month ${snowball.debts[0]!.paidOffInMonth}. Total interest: about ${approx(snowball.totalInterestMinor, 100)}`);
    expect(text).toContain(`Avalanche clears B in month ${avalanche.debts[1]!.paidOffInMonth}. Total interest: about ${approx(avalanche.totalInterestMinor, 100)}`);
    expect(snowball.monthsToDebtFree).toBe(12);
    expect(avalanche.monthsToDebtFree).toBe(12);
    expect(text).toContain(`Avalanche costs about ${approx(r.difference!.interestSavedByAvalancheMinor, 100)} less`);
  });

  it('compound-growth', () => {
    const text = lessonText('compound-growth');
    const at = (months: number) => calcSavingsProjection({ startingBalanceMinor: 0, monthlyContributionMinor: 500_000, annualRateBps: 800, months, startDate });
    const [ten, twenty] = [at(120), at(240)];
    expect(text).toContain(`put in ${approx(ten.totalContributedMinor, 1)}. At 8% a year it has grown to about ${approx(ten.finalBalanceMinor, 5000)}`);
    expect(text).toContain(`put in ${approx(twenty.totalContributedMinor, 1)}. At 8% a year it has grown to about ${approx(twenty.finalBalanceMinor, 5000)}`);
    expect(text).toContain(`growth added about ${approx(ten.totalGrowthMinor, 5000)}`);
    expect(text).toContain(`it added about ${approx(twenty.totalGrowthMinor - ten.totalGrowthMinor, 5000)}`);
  });

  it('emergency-fund', () => {
    const r = calcEmergencyFund({ essentialMonthlyMinor: 4_000_000, targetMonths: 3, currentBalanceMinor: 3_000_000, monthlyContributionMinor: 1_000_000, startDate });
    expect(lessonText('emergency-fund')).toContain(`the gap of ${approx(r.gapMinor, 1)} closes in ${r.monthsToTarget} months`);
  });

  it('comparing-loans', () => {
    const text = lessonText('comparing-loans');
    const loan = (aprBps: number, pay: number) =>
      calcDebtPayoff({ debts: [{ id: 'l', balanceMinor: 10_000_000, aprBps, minimumPaymentMinor: 0 }], monthlyBudgetMinor: pay, strategy: 'avalanche', startDate }) as DebtPayoffPlan;
    const reducing = loan(1200, 888_488);
    expect(reducing.monthsToDebtFree).toBe(12);
    expect(text).toContain(`Interest is about ${approx(reducing.totalInterestMinor, 100)}`);
    // A flat 12% means repaying 112,000 in twelve equal payments. That is what a
    // reducing-balance loan at about 21% charges: 21% clears in 12 months, 22% does not.
    expect(loan(2100, 933_334).monthsToDebtFree).toBe(12);
    expect(loan(2200, 933_334).monthsToDebtFree).toBe(13);
    expect(text).toContain('about 21%');
  });
});

describe('recommendLessons', () => {
  const base: Summary = { monthlyIncome: 100_000, monthlyExpenses: 50_000, monthlyEssentialExpenses: 40_000, monthlyDebtMinimums: 0, monthlySurplus: 50_000, totalDebt: 0, totalSavings: 200_000, emergencyFund: 200_000, highestAprBps: null };
  const pick = (over: Partial<Summary>, done: string[] = []) => {
    const summary = { ...base, ...over };
    return recommendLessons(summary, profileWarnings(summary), new Set(done)).map((l) => l.slug);
  };

  it('puts interest and payoff lessons first for someone with expensive debt', () => {
    const picks = pick({ totalDebt: 300_000, highestAprBps: 3600, monthlyDebtMinimums: 10_000 });
    expect(picks).toHaveLength(3);
    expect(picks[0]).toBe('how-interest-works');
    expect(picks).toEqual(expect.arrayContaining(['minimum-payment-trap', 'snowball-vs-avalanche']));
  });

  it('leads with the emergency fund when it is thin', () => {
    expect(pick({ emergencyFund: 0 })[0]).toBe('emergency-fund');
  });

  it('starts an empty profile with the basics', () => {
    const picks = pick({ monthlyIncome: 0, monthlyExpenses: 0, totalSavings: 0, emergencyFund: 0 });
    expect(picks.every((slug) => getLesson(slug).tags.includes('getting-started'))).toBe(true);
    expect(picks.every((slug) => getLesson(slug).difficulty === 1)).toBe(true);
  });

  it('addresses overspending', () => {
    expect(pick({ monthlySurplus: -1 })).toEqual(expect.arrayContaining(['budgeting-basics', 'fifty-thirty-twenty']));
  });

  it('skips completed lessons and still suggests something to a healthy profile', () => {
    expect(pick({}).length).toBe(3);
    expect(pick({ emergencyFund: 0 }, ['emergency-fund'])).not.toContain('emergency-fund');
    expect(pick({}, LESSONS.map((l) => l.slug))).toEqual([]);
  });
});

describe('assignments, progress and quizzes', () => {
  const ctx = testCtx();
  const AGENT: Actor = { type: 'agent', connectionId: null };
  const right = (slug: string) => getLesson(slug).quiz.map((q) => q.correctIndex);
  const wrong = (slug: string) => getLesson(slug).quiz.map((q) => (q.correctIndex + 1) % q.options.length);
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    alice = await createUser(ctx);
    bob = await createUser(ctx);
  });
  afterAll(() => ctx.close());

  it('assigns lessons with a reason and reports what was skipped', async () => {
    const result = await assignLessons(ctx, alice, AGENT, { lessonSlugs: ['how-interest-works', 'emergency-fund', 'made-up', 'emergency-fund'], reason: 'Card debt at 36% SENTINEL-77' });
    expect(result).toEqual({ assigned: ['how-interest-works', 'emergency-fund'], skipped: [{ slug: 'made-up', why: 'unknown_lesson' }] });
    const states = await getLessonStates(ctx, alice);
    expect(states.get('how-interest-works')).toMatchObject({ status: 'not_started', assignment: { status: 'assigned', by: 'agent', reason: 'Card debt at 36% SENTINEL-77' } });
    const rows = await ctx.db.query.lessonAssignments.findMany();
    expect(JSON.stringify(rows)).not.toContain('SENTINEL-77');
    expect((await getLessonStates(ctx, bob)).size).toBe(0);
  });

  it('does not assign the same lesson twice', async () => {
    expect(await assignLessons(ctx, alice, USER, { lessonSlugs: ['emergency-fund'], reason: 'again' })).toEqual({ assigned: [], skipped: [{ slug: 'emergency-fund', why: 'already_assigned' }] });
  });

  it('limits how many can be assigned at once and requires a reason', async () => {
    await expect(assignLessons(ctx, alice, AGENT, { lessonSlugs: LESSONS.slice(0, 6).map((l) => l.slug), reason: 'x' })).rejects.toThrow();
    await expect(assignLessons(ctx, alice, AGENT, { lessonSlugs: [], reason: 'x' })).rejects.toThrow();
    await expect(assignLessons(ctx, alice, AGENT, { lessonSlugs: ['setting-goals'], reason: ' ' })).rejects.toThrow();
  });

  it('tracks starting a lesson', async () => {
    await startLesson(ctx, alice, 'how-interest-works');
    await startLesson(ctx, alice, 'how-interest-works');
    expect((await getLessonStates(ctx, alice)).get('how-interest-works')).toMatchObject({ status: 'started', bestScore: null });
    await expect(startLesson(ctx, alice, 'nope')).rejects.toThrow(NotFoundError);
  });

  it('a failed quiz keeps the lesson open', async () => {
    const outcome = await submitQuiz(ctx, alice, 'how-interest-works', wrong('how-interest-works'));
    expect(outcome).toMatchObject({ correct: 0, total: 3, passed: false });
    expect((await getLessonStates(ctx, alice)).get('how-interest-works')).toMatchObject({ status: 'started', bestScore: 0, assignment: { status: 'assigned' } });
  });

  it('passing with two of three completes the lesson and its assignment', async () => {
    const answers = right('how-interest-works');
    answers[2] = (answers[2]! + 1) % 4;
    expect(await submitQuiz(ctx, alice, 'how-interest-works', answers)).toMatchObject({ correct: 2, passed: true });
    expect((await getLessonStates(ctx, alice)).get('how-interest-works')).toMatchObject({ status: 'completed', bestScore: 67, assignment: { status: 'completed' } });
    expect(await getLatestAttempt(ctx, alice, 'how-interest-works')).toMatchObject({ correct: 2, total: 3, passed: true, answers });
  });

  it('a later worse attempt does not undo completion or lower the best score', async () => {
    await submitQuiz(ctx, alice, 'how-interest-works', wrong('how-interest-works'));
    expect((await getLessonStates(ctx, alice)).get('how-interest-works')).toMatchObject({ status: 'completed', bestScore: 67 });
    await submitQuiz(ctx, alice, 'how-interest-works', right('how-interest-works'));
    expect((await getLessonStates(ctx, alice)).get('how-interest-works')).toMatchObject({ status: 'completed', bestScore: 100 });
  });

  it('rejects malformed answers', async () => {
    await expect(submitQuiz(ctx, alice, 'emergency-fund', [0, 1])).rejects.toThrow();
    await expect(submitQuiz(ctx, alice, 'emergency-fund', [0, 1, 2.5])).rejects.toThrow();
    await expect(submitQuiz(ctx, alice, 'emergency-fund', [0, 1, -1])).rejects.toThrow();
    await expect(submitQuiz(ctx, alice, 'nope', [0, 1, 2])).rejects.toThrow(NotFoundError);
  });

  it('will not re-assign a completed lesson', async () => {
    expect((await assignLessons(ctx, alice, AGENT, { lessonSlugs: ['how-interest-works'], reason: 'again' })).skipped).toEqual([{ slug: 'how-interest-works', why: 'already_completed' }]);
  });

  it('lets the user dismiss an assignment, and stops an agent re-adding it', async () => {
    await dismissAssignment(ctx, alice, 'emergency-fund');
    expect((await getLessonStates(ctx, alice)).get('emergency-fund')!.assignment!.status).toBe('dismissed');
    expect((await assignLessons(ctx, alice, AGENT, { lessonSlugs: ['emergency-fund'], reason: 'please' })).skipped).toEqual([{ slug: 'emergency-fund', why: 'dismissed_by_user' }]);
    await expect(dismissAssignment(ctx, alice, 'emergency-fund')).rejects.toThrow(NotFoundError);
    await expect(dismissAssignment(ctx, bob, 'how-interest-works')).rejects.toThrow(NotFoundError);
  });

  it('keeps each user\'s progress separate', async () => {
    expect(await getLatestAttempt(ctx, bob, 'how-interest-works')).toBeNull();
    await submitQuiz(ctx, bob, 'setting-goals', right('setting-goals'));
    expect((await getLessonStates(ctx, alice)).has('setting-goals')).toBe(false);
    expect((await getLessonStates(ctx, bob)).get('setting-goals')).toMatchObject({ status: 'completed', bestScore: 100, assignment: null });
  });
});
