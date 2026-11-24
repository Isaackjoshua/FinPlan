import { ScenarioNotes, ScenarioTable } from '@/components/income-scenarios';
import { monthName } from '@/components/plan-results';
import { Empty, Flash, formatDay, formatPeriod, humanise, PageHeader } from '@/components/ui';
import { run, str, today } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import {
  changedSince,
  COMPLETENESS_CODES,
  effectiveGoals,
  expenseTiers,
  formatAmount,
  getCurrentPlan,
  getLessonStates,
  listCheckIns,
  listLessons,
  loadProfileCheck,
  obligations,
  recommendLessons,
  setAside,
  setWarningAcknowledged,
  type CompletenessCode,
} from '@fin/core';
import Link from 'next/link';

export const metadata = { title: 'Dashboard' };

/** What the user is saying when they settle a completeness check. */
const ANSWERS: Record<CompletenessCode, string> = {
  no_housing_recorded: 'I pay nothing for housing',
  no_food_recorded: 'I pay nothing for food',
  expenses_look_low: 'My spending is this low',
  surplus_unreliable: 'That is all my spending',
};
const isCompletenessCode = (code: string): code is CompletenessCode => (COMPLETENESS_CODES as readonly string[]).includes(code);

async function acknowledge(form: FormData) {
  'use server';
  const { userId } = await requireProfile();
  const code = str(form, 'code');
  await run('/dashboard', async () => {
    if (isCompletenessCode(code)) await setWarningAcknowledged(getCtx(), userId, code, str(form, 'acknowledged') === 'yes');
  }, 'Saved.');
}

function AnswerForm({ code, acknowledged, children }: { code: CompletenessCode; acknowledged: boolean; children: string }) {
  return (
    <form action={acknowledge} className="inline">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="acknowledged" value={acknowledged ? 'yes' : 'no'} />
      <button className="link cursor-pointer">{children}</button>
    </form>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId, name, profile } = await requireProfile();
  const ctx = getCtx();
  const cur = profile.currency;
  const [check, plan, checkIns, lessonStates] = await Promise.all([
    loadProfileCheck(ctx, userId, profile, today()),
    getCurrentPlan(ctx, userId),
    listCheckIns(ctx, userId, 1),
    getLessonStates(ctx, userId),
  ]);
  const { items, summary: s, warnings, scenarios, surplusReliable, acknowledged } = check;
  const goals = effectiveGoals(check.goals, items);
  const bills = obligations(items, today(), check.given);
  const tiers = expenseTiers(items);
  // While another check is open, settling "unreliable" on its own would change nothing.
  const openChecks = warnings.filter((w) => isCompletenessCode(w.code) && w.code !== 'surplus_unreliable').length;
  const activeGoals = goals.filter((g) => g.status === 'active');
  const spentShare = s.monthlyIncome > 0 ? Math.round((s.monthlyExpenses / s.monthlyIncome) * 100) : 0;
  const monthsCovered = s.monthlyEssentialExpenses > 0 ? (s.emergencyFund / s.monthlyEssentialExpenses).toFixed(1) : null;
  const lastCheckIn = checkIns[0];
  const lessons = listLessons();
  const completedLessons = new Set([...lessonStates].filter(([, st]) => st.status === 'completed').map(([slug]) => slug));
  const assignedLessons = lessons.filter((l) => lessonStates.get(l.slug)?.assignment?.status === 'assigned');
  // Assigned lessons come first; otherwise fall back to what the profile suggests.
  const nextLessons = (assignedLessons.length > 0 ? assignedLessons : recommendLessons(s, warnings, completedLessons)).slice(0, 3);
  const debtPlan = plan?.results?.debt?.[plan.inputs.debtStrategy ?? 'avalanche'];

  return (
    <>
      <PageHeader title={`Hello, ${name}`}>Where things stand today.</PageHeader>
      <Flash searchParams={searchParams} />

      {items.length === 0 ? (
        <section className="card mb-6">
          <h2 className="text-lg font-semibold">Start with your profile</h2>
          <p className="mt-1 text-sm text-muted">Add your income, expenses, debts and savings. Everything else builds on that.</p>
          <Link href="/profile" className="btn mt-4">Fill in your profile</Link>
        </section>
      ) : (
        <section aria-labelledby="month-heading" className="card mb-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:gap-10">
            <div>
              <h2 id="month-heading" className="text-sm font-medium text-muted">{surplusReliable ? `${s.monthlySurplus < 0 ? 'Short' : 'Left over'} ${scenarios ? 'in a lean month' : 'each month'}` : 'Left over each month'}</h2>
              {surplusReliable ? (
                <p className={`num mt-1 text-[2.5rem] font-semibold leading-none tracking-tight sm:text-5xl ${s.monthlySurplus < 0 ? 'text-danger' : 'text-brand'}`}>
                  {formatAmount(Math.abs(s.monthlySurplus), cur)}
                </p>
              ) : (
                <>
                  <p className="mt-1 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">Not enough information yet</p>
                  <p className="mt-2 text-sm text-muted">
                    {scenarios ? (
                      'What is recorded so far leaves money over in some months, but spending looks incomplete.'
                    ) : (
                      <>What is recorded so far leaves <span className="num">{formatAmount(s.monthlySurplus, cur)}</span>, but spending looks incomplete.</>
                    )}{' '}
                    <Link href="/profile" className="link">Add what is missing</Link>
                  </p>
                </>
              )}
              {/* Where each month's income goes: spent, and what remains (or the gap). */}
              <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-brand-soft" role="img" aria-label={`Expenses take ${spentShare}% of income`}>
                <div className={`h-full ${s.monthlySurplus < 0 ? 'bg-danger' : 'bg-ink'}`} style={{ width: `${Math.min(100, spentShare)}%` }} />
              </div>
              <dl className="mt-3 flex flex-wrap justify-between gap-x-6 gap-y-1 text-sm">
                <div className="flex gap-1.5"><dt className="text-muted">{scenarios ? 'Lean income' : 'Income'}</dt><dd className="num font-medium">{formatAmount(s.monthlyIncome, cur)}</dd></div>
                <div className="flex gap-1.5"><dt className="text-muted">Expenses</dt><dd className="num font-medium">{formatAmount(s.monthlyExpenses, cur)} <span className="font-normal text-muted">({spentShare}%)</span></dd></div>
              </dl>
              <p className="mt-3 text-sm"><Link href="/cash-flow" className="link">See when money comes and goes</Link></p>
            </div>
            <dl className="divide-y divide-line border-t border-line text-[0.9375rem] lg:border-t-0 lg:border-l lg:pl-10">
              <div className="flex items-baseline justify-between gap-4 py-3 lg:pt-0"><dt className="text-muted">Total debt</dt><dd className="num font-semibold">{formatAmount(s.totalDebt, cur)}</dd></div>
              <div className="flex items-baseline justify-between gap-4 py-3"><dt className="text-muted">Total savings</dt><dd className="num font-semibold">{formatAmount(s.totalSavings, cur)}</dd></div>
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="text-muted">Emergency fund</dt>
                <dd className="num font-semibold">{monthsCovered ? `${monthsCovered} months of essentials` : formatAmount(s.emergencyFund, cur)}</dd>
              </div>
              {tiers.classified && tiers.committedMinor > 0 && (
                <p className="pt-3 text-xs text-muted">It is for what you cannot live without (<span className="num">{formatAmount(tiers.survivalMinor, cur)}</span> a month), not for commitments of <span className="num">{formatAmount(tiers.committedMinor, cur)}</span>.</p>
              )}
            </dl>
          </div>
        </section>
      )}

      {scenarios && surplusReliable && (
        <section className="card mb-6 text-sm">
          <h2 className="text-lg font-semibold">When your income varies</h2>
          <div className="mt-2 grid gap-x-10 gap-y-3 lg:grid-cols-2">
            <ScenarioTable result={scenarios} currency={cur} />
            <div className="text-muted lg:pt-2">
              <ScenarioNotes result={scenarios} currency={cur} basis={check.band.basis} monthsObserved={check.band.monthsObserved} />
              {scenarios.scenarios.some((one) => one.incomeMinor === null) && (
                <p className="mt-2"><Link href="/profile" className="link">Add what you know about other months</Link></p>
              )}
            </div>
          </div>
        </section>
      )}

      {bills.items.length > 0 && (
        <section className="card mb-6 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="text-lg font-semibold">Big bills ahead</h2>
            <p className="text-muted">{bills.setAsideMinor > 0 ? <>Still to set aside this month: <span className="num font-semibold text-ink">{formatAmount(bills.setAsideMinor, cur)}</span></> : 'Set aside for this month'}</p>
          </div>
          <p className="mt-1 text-muted">Your expenses above count <span className="num">{formatAmount(bills.smoothedMonthlyMinor, cur)}</span> a month for these, spread out evenly. They really come all at once.</p>
          <ul className="mt-2 divide-y divide-line">
            {bills.items.map((bill) => (
              <li key={bill.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
                <span>
                  <span className="font-medium">{bill.label}</span> <span className="num text-muted">{formatAmount(bill.amountMinor, cur)} {humanise(bill.frequency).toLowerCase()} · {bill.dueDate ? `due ${formatDay(bill.dueDate)}` : 'due date not known'}{bill.reservedMinor > 0 && ` · ${formatAmount(bill.reservedMinor, cur)} set aside`}</span>
                  {bill.dueDatePassed && <span className="block text-xs text-warn">The date recorded has passed, so it is taken as paid. Mark it paid or correct it on your <Link href="/profile" className="link">profile</Link>.</span>}
                </span>
                <span className="num font-semibold">{formatAmount(setAside(bill), cur)} a month</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section className="mb-6 rounded-2xl border border-warn/25 bg-warn/5 p-5 sm:p-6">
          <h2 className="font-semibold text-warn">Worth a look</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {warnings.map((w) => (
              <li key={w.code}>
                {w.message}
                {isCompletenessCode(w.code) && (w.code !== 'surplus_unreliable' || openChecks === 0) && (
                  <> <AnswerForm code={w.code} acknowledged>{ANSWERS[w.code]}</AnswerForm></>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {acknowledged.length > 0 && (
        <ul className="mb-6 space-y-1 text-sm text-muted">
          {acknowledged.map((code) => (
            <li key={code}>You told FinPlan: “{ANSWERS[code]}”. <AnswerForm code={code} acknowledged={false}>Undo</AnswerForm></li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Your plan</h2>
            <Link href="/plan" className="link text-sm">{plan ? 'Open' : 'Create'}</Link>
          </div>
          {plan ? (
            <>
              <p className="text-xs text-muted">Version {plan.version}, saved by {plan.savedBy === 'agent' ? 'your agent' : 'you'}</p>
              {changedSince(plan, profile) && <p className="mt-1 text-xs text-warn">Your profile or goals have changed since it was saved.</p>}
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm">{plan.summary}</p>
              {debtPlan?.feasible && debtPlan.debtFreeMonth && (
                <p className="mt-3 text-sm">Debt-free by <span className="font-semibold">{monthName(debtPlan.debtFreeMonth)}</span></p>
              )}
              {plan.results?.emergencyFund.targetReachedMonth && (
                <p className="text-sm">Emergency fund full by <span className="font-semibold">{monthName(plan.results.emergencyFund.targetReachedMonth)}</span></p>
              )}
            </>
          ) : (
            <Empty>No plan yet.</Empty>
          )}
        </section>

        <section className="card">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Goals</h2>
            <span className="flex gap-4"><Link href="/share-out" className="link text-sm">Share out money</Link><Link href="/goals" className="link text-sm">Manage</Link></span>
          </div>
          {activeGoals.length === 0 ? (
            <Empty>No active goals.</Empty>
          ) : (
            <ul className="space-y-3">
              {activeGoals.map((goal) => {
                const pct = goal.targetAmountMinor > 0 ? Math.min(100, Math.round((goal.currentAmountMinor / goal.targetAmountMinor) * 100)) : 0;
                return (
                  <li key={goal.id} className="text-sm">
                    <div className="flex justify-between gap-3"><span>{goal.title}</span><span className="num text-muted">{pct}%</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper"><div className="h-full bg-brand" style={{ width: `${pct}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card lg:col-span-2">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Lessons</h2>
            <Link href="/lessons" className="link text-sm">All lessons</Link>
          </div>
          <p className="text-sm text-muted">
            {completedLessons.size} of {lessons.length} completed
            {assignedLessons.length > 0 && <> · {assignedLessons.length} assigned to you</>}
          </p>
          {nextLessons.length > 0 && (
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {nextLessons.map((lesson) => (
                <li key={lesson.slug}>
                  <Link href={`/lessons/${lesson.slug}`} className="block h-full rounded-xl border border-line px-3.5 py-3 text-sm transition-colors hover:border-brand/40 hover:bg-paper">
                    <span className="font-medium">{lesson.title}</span>
                    <span className="block text-xs text-muted">{assignedLessons.length > 0 ? 'Assigned' : 'Suggested'} · {lesson.minutes} min</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card lg:col-span-2">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Latest check-in</h2>
            <Link href="/check-ins" className="link text-sm">{lastCheckIn ? 'All check-ins' : 'Log one'}</Link>
          </div>
          {lastCheckIn ? (
            <p className="num text-sm text-muted">
              {formatPeriod(lastCheckIn.periodStart, lastCheckIn.periodEnd)}: income {formatAmount(lastCheckIn.actuals.incomeMinor, cur)}, spent{' '}
              {formatAmount(lastCheckIn.actuals.spending.reduce((sum, r) => sum + r.amountMinor, 0), cur)}, saved {formatAmount(lastCheckIn.actuals.savingsAddedMinor, cur)}.
            </p>
          ) : (
            <Empty>No check-ins yet.</Empty>
          )}
        </section>
      </div>
    </>
  );
}
