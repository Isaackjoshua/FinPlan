import { monthName } from '@/components/plan-results';
import { Empty, PageHeader, Stat } from '@/components/ui';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import { formatAmount, getCurrentPlan, listCheckIns, listGoals, listItems, profileWarnings, summarise } from '@fin/core';
import Link from 'next/link';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const { userId, name, profile } = await requireProfile();
  const ctx = getCtx();
  const cur = profile.currency;
  const [items, goals, plan, checkIns] = await Promise.all([
    listItems(ctx, userId),
    listGoals(ctx, userId),
    getCurrentPlan(ctx, userId),
    listCheckIns(ctx, userId, 1),
  ]);
  const s = summarise(items);
  const warnings = profileWarnings(s);
  const activeGoals = goals.filter((g) => g.status === 'active');
  const monthsCovered = s.monthlyEssentialExpenses > 0 ? (s.emergencyFund / s.monthlyEssentialExpenses).toFixed(1) : null;
  const lastCheckIn = checkIns[0];
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
        <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Monthly income" value={formatAmount(s.monthlyIncome, cur)} />
          <Stat label="Monthly expenses" value={formatAmount(s.monthlyExpenses, cur)} />
          <Stat label={s.monthlySurplus < 0 ? 'Monthly shortfall' : 'Left over each month'} value={formatAmount(Math.abs(s.monthlySurplus), cur)} tone={s.monthlySurplus < 0 ? 'bad' : 'good'} />
          <Stat label="Total debt" value={formatAmount(s.totalDebt, cur)} />
          <Stat label="Total savings" value={formatAmount(s.totalSavings, cur)} />
          <Stat label="Emergency fund" value={monthsCovered ? `${monthsCovered} months` : formatAmount(s.emergencyFund, cur)} />
        </section>
      )}

      {warnings.length > 0 && (
        <section className="mb-6 rounded-xl border border-warn/30 bg-warn/5 p-5">
          <h2 className="font-semibold text-warn">Worth a look</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {warnings.map((w) => <li key={w.code}>{w.message}</li>)}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <div className="mb-2 flex items-baseline justify-between">
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
          <div className="mb-2 flex items-baseline justify-between">
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
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Latest check-in</h2>
            <Link href="/check-ins" className="link text-sm">{lastCheckIn ? 'All check-ins' : 'Log one'}</Link>
          </div>
          {lastCheckIn ? (
            <p className="num text-sm text-muted">
              {lastCheckIn.periodStart} to {lastCheckIn.periodEnd}: income {formatAmount(lastCheckIn.actuals.incomeMinor, cur)}, spent{' '}
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
