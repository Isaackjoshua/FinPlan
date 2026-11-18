import { monthName } from '@/components/plan-results';
import { Empty, formatPeriod, PageHeader } from '@/components/ui';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import { formatAmount, getCurrentPlan, getLessonStates, listCheckIns, listGoals, listItems, listLessons, profileWarnings, recommendLessons, summarise } from '@fin/core';
import Link from 'next/link';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const { userId, name, profile } = await requireProfile();
  const ctx = getCtx();
  const cur = profile.currency;
  const [items, goals, plan, checkIns, lessonStates] = await Promise.all([
    listItems(ctx, userId),
    listGoals(ctx, userId),
    getCurrentPlan(ctx, userId),
    listCheckIns(ctx, userId, 1),
    getLessonStates(ctx, userId),
  ]);
  const s = summarise(items);
  const warnings = profileWarnings(s);
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
              <h2 id="month-heading" className="text-sm font-medium text-muted">{s.monthlySurplus < 0 ? 'Short each month' : 'Left over each month'}</h2>
              <p className={`num mt-1 text-[2.5rem] font-semibold leading-none tracking-tight sm:text-5xl ${s.monthlySurplus < 0 ? 'text-danger' : 'text-brand'}`}>
                {formatAmount(Math.abs(s.monthlySurplus), cur)}
              </p>
              {/* Where each month's income goes: spent, and what remains (or the gap). */}
              <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-brand-soft" role="img" aria-label={`Expenses take ${spentShare}% of income`}>
                <div className={`h-full ${s.monthlySurplus < 0 ? 'bg-danger' : 'bg-ink'}`} style={{ width: `${Math.min(100, spentShare)}%` }} />
              </div>
              <dl className="mt-3 flex flex-wrap justify-between gap-x-6 gap-y-1 text-sm">
                <div className="flex gap-1.5"><dt className="text-muted">Income</dt><dd className="num font-medium">{formatAmount(s.monthlyIncome, cur)}</dd></div>
                <div className="flex gap-1.5"><dt className="text-muted">Expenses</dt><dd className="num font-medium">{formatAmount(s.monthlyExpenses, cur)} <span className="font-normal text-muted">({spentShare}%)</span></dd></div>
              </dl>
            </div>
            <dl className="divide-y divide-line border-t border-line text-[0.9375rem] lg:border-t-0 lg:border-l lg:pl-10">
              <div className="flex items-baseline justify-between gap-4 py-3 lg:pt-0"><dt className="text-muted">Total debt</dt><dd className="num font-semibold">{formatAmount(s.totalDebt, cur)}</dd></div>
              <div className="flex items-baseline justify-between gap-4 py-3"><dt className="text-muted">Total savings</dt><dd className="num font-semibold">{formatAmount(s.totalSavings, cur)}</dd></div>
              <div className="flex items-baseline justify-between gap-4 py-3 lg:pb-0">
                <dt className="text-muted">Emergency fund</dt>
                <dd className="num font-semibold">{monthsCovered ? `${monthsCovered} months of essentials` : formatAmount(s.emergencyFund, cur)}</dd>
              </div>
            </dl>
          </div>
        </section>
      )}

      {warnings.length > 0 && (
        <section className="mb-6 rounded-2xl border border-warn/25 bg-warn/5 p-5 sm:p-6">
          <h2 className="font-semibold text-warn">Worth a look</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {warnings.map((w) => <li key={w.code}>{w.message}</li>)}
          </ul>
        </section>
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
            <Link href="/goals" className="link text-sm">Manage</Link>
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
