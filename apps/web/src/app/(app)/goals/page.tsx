import { Empty, Field, Flash, humanise, PageHeader } from '@/components/ui';
import { money, run, str } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import { createGoal, formatAmount, GOAL_KINDS, GOAL_STATUSES, listGoals, toDecimalString, updateGoal, USER, type Goal, type GoalStatus } from '@fin/core';

export const metadata = { title: 'Goals' };

async function saveGoal(form: FormData) {
  'use server';
  const { userId, profile } = await requireProfile();
  await run('/goals', async () => {
    const fields = {
      kind: str(form, 'kind') as (typeof GOAL_KINDS)[number],
      title: str(form, 'title'),
      targetAmountMinor: money(form, 'target', profile.currency, 'Target'),
      currentAmountMinor: money(form, 'current', profile.currency, 'Saved so far'),
      targetDate: str(form, 'targetDate') || undefined,
      priority: Number(str(form, 'priority') || 3),
    };
    const id = str(form, 'id');
    if (id) await updateGoal(getCtx(), userId, USER, id, { ...fields, status: str(form, 'status') as GoalStatus });
    else await createGoal(getCtx(), userId, USER, fields);
  }, 'Saved.');
}

function GoalForm({ goal, currency }: { goal?: Goal; currency: string }) {
  return (
    <form action={saveGoal} className="mt-3 grid gap-3 sm:grid-cols-2">
      {goal && <input type="hidden" name="id" value={goal.id} />}
      <Field label="What is it for?"><input name="title" required maxLength={120} defaultValue={goal?.title} className="input" /></Field>
      <Field label="Type">
        <select name="kind" defaultValue={goal?.kind ?? 'other'} className="input">
          {GOAL_KINDS.map((k) => <option key={k} value={k}>{humanise(k)}</option>)}
        </select>
      </Field>
      <Field label={`Target (${currency})`}>
        <input name="target" required inputMode="decimal" defaultValue={goal ? toDecimalString(goal.targetAmountMinor, currency) : ''} className="input" />
      </Field>
      <Field label={`Saved so far (${currency})`}>
        <input name="current" required inputMode="decimal" defaultValue={toDecimalString(goal?.currentAmountMinor ?? 0, currency)} className="input" />
      </Field>
      <Field label="Target date (optional)"><input name="targetDate" type="date" defaultValue={goal?.targetDate} className="input" /></Field>
      <Field label="Priority" hint="1 is most important.">
        <input name="priority" type="number" min={1} max={5} defaultValue={goal?.priority ?? 3} className="input" />
      </Field>
      {goal && (
        <Field label="Status">
          <select name="status" defaultValue={goal.status} className="input">
            {GOAL_STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
          </select>
        </Field>
      )}
      <div className="sm:col-span-2"><button className="btn">{goal ? 'Save changes' : 'Add goal'}</button></div>
    </form>
  );
}

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId, profile } = await requireProfile();
  const goals = await listGoals(getCtx(), userId);
  const cur = profile.currency;
  return (
    <>
      <PageHeader title="Goals">What you are working towards. Your plan sets aside money for each active goal.</PageHeader>
      <Flash searchParams={searchParams} />
      <section className="card">
        {goals.length === 0 ? (
          <Empty>No goals yet. Add one below, or ask your agent to help you choose.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {goals.map((goal) => {
              const pct = goal.targetAmountMinor > 0 ? Math.min(100, Math.round((goal.currentAmountMinor / goal.targetAmountMinor) * 100)) : 0;
              return (
                <li key={goal.id} className="py-3">
                  <details>
                    <summary className="cursor-pointer">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                        <span className="font-medium">{goal.title} {goal.status !== 'active' && <span className="text-xs font-normal text-muted">({goal.status})</span>}</span>
                        <span className="num text-sm text-muted">{formatAmount(goal.currentAmountMinor, cur)} of {formatAmount(goal.targetAmountMinor, cur)} · {pct}%</span>
                      </span>
                      <span className="mt-2 block h-2 overflow-hidden rounded-full bg-paper"><span className="block h-full bg-brand" style={{ width: `${pct}%` }} /></span>
                    </summary>
                    <GoalForm goal={goal} currency={cur} />
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        <details className="mt-3">
          <summary className="link cursor-pointer text-sm">Add a goal</summary>
          <GoalForm currency={cur} />
        </details>
      </section>
    </>
  );
}
