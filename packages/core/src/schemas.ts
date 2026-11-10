import { z } from 'zod';
import { FREQUENCIES, isSupportedCurrency } from './money';

/**
 * Every input, from the web forms now and from agents later, is parsed by these
 * schemas before it reaches the database.
 */

// Control characters have no place in labels or notes, and stripping them removes
// one way of hiding text from a human reviewer.
const stripControl = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

export const text = (max: number) =>
  z.string().transform(stripControl).pipe(z.string().trim().min(1).max(max));
export const optionalText = (max: number) =>
  z.string().transform(stripControl).pipe(z.string().trim().max(max)).optional();

/** Non-negative whole minor units, capped well inside the safe-integer range. */
export const amount = z.number().int().min(0).max(1e13);
/** Basis points: 1999 means 19.99%. Capped at 1000%. */
export const rateBps = z.number().int().min(0).max(100_000);

export const frequency = z.enum(FREQUENCIES);
export const isoDate = z.iso.date();

export const EXPENSE_CATEGORIES = [
  'housing',
  'utilities',
  'food',
  'transport',
  'health',
  'insurance',
  'education',
  'childcare',
  'personal',
  'entertainment',
  'giving',
  'other',
] as const;
export const expenseCategory = z.enum(EXPENSE_CATEGORIES);

export const DEBT_KINDS = ['credit_card', 'personal_loan', 'student_loan', 'mortgage', 'vehicle', 'mobile_loan', 'informal', 'other'] as const;

export const profileSetup = z.object({
  country: z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter country code'),
  currency: z.string().refine(isSupportedCurrency, 'Unknown currency'),
});

export const profileDetails = z.object({
  payFrequency: frequency.optional(),
  householdSize: z.number().int().min(1).max(30).optional(),
  notes: optionalText(2000),
});
export type ProfileDetails = z.infer<typeof profileDetails>;

export const itemData = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('income'), label: text(80), amountMinor: amount, frequency }),
  z.object({
    kind: z.literal('expense'),
    label: text(80),
    amountMinor: amount,
    frequency,
    category: expenseCategory,
    essential: z.boolean(),
  }),
  z.object({
    kind: z.literal('debt'),
    label: text(80),
    debtKind: z.enum(DEBT_KINDS),
    balanceMinor: amount,
    aprBps: rateBps,
    minimumPaymentMinor: amount,
  }),
  z.object({
    kind: z.literal('savings'),
    label: text(80),
    balanceMinor: amount,
    apyBps: rateBps,
    isEmergencyFund: z.boolean(),
  }),
]);
export type ItemData = z.infer<typeof itemData>;
export type ItemKind = ItemData['kind'];

export const GOAL_KINDS = ['emergency_fund', 'debt_free', 'purchase', 'education', 'retirement', 'other'] as const;
export const GOAL_STATUSES = ['active', 'paused', 'achieved', 'abandoned'] as const;

export const goalData = z.object({
  kind: z.enum(GOAL_KINDS),
  title: text(120),
  targetAmountMinor: amount,
  currentAmountMinor: amount.default(0),
  targetDate: isoDate.optional(),
  priority: z.number().int().min(1).max(5).default(3),
});
export type GoalData = z.infer<typeof goalData>;
export const goalStatus = z.enum(GOAL_STATUSES);
export type GoalStatus = z.infer<typeof goalStatus>;

/** The choices that make up a plan. Projections are computed from these by the engine (milestone 2). */
export const planInputs = z.object({
  budget: z.array(z.object({ category: expenseCategory, amountMinor: amount })).max(20),
  debtStrategy: z.enum(['snowball', 'avalanche']).optional(),
  extraDebtPaymentMinor: amount.default(0),
  emergencyFundMonths: z.number().int().min(0).max(24).default(3),
  goalContributions: z.array(z.object({ goalId: z.uuid(), amountMinor: amount })).max(20).default([]),
});
export type PlanInputs = z.infer<typeof planInputs>;

export const planVersionInput = z.object({
  summary: text(1000),
  inputs: planInputs,
  /** If given, the save is rejected unless this is still the current version. */
  baseVersion: z.number().int().positive().optional(),
});

export const checkInInput = z
  .object({
    periodStart: isoDate,
    periodEnd: isoDate,
    actuals: z.object({
      incomeMinor: amount,
      spending: z.array(z.object({ category: expenseCategory, amountMinor: amount })).max(20),
      debtPaymentsMinor: amount.default(0),
      savingsAddedMinor: amount.default(0),
    }),
    note: optionalText(1000),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: 'Period end is before its start', path: ['periodEnd'] });
export type CheckInInput = z.infer<typeof checkInInput>;
