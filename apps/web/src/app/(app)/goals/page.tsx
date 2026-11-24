import { Empty, Field, Flash, formatDay, humanise, PageHeader } from '@/components/ui';
import { expectedRevision, money, optionalInt, optionalMoney, run, str, today } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import {
  createGoal,
  effectiveGoals,
  formatAmount,
  GOAL_KINDS,
  GOAL_STATUSES,
  goalFeasibility,
  leftOver,
  loadProfileCheck,
  toDecimalString,
  updateGoal,
  USER,
  type Goal,
  type GoalStatus,
  type Item,
} from '@fin/core';
import Link from 'next/link';

export const metadata = { title: 'Goals' };

const SPARE_PARTS = 3;

async function saveGoal(form: FormData) {
  'use server';
  const { userId, profile } = await requireProfile();
  const cur = profile.currency;
  await run('/goals', async () => {
    const parts = Array.from({ length: 20 }, (_, i) => i).flatMap((i) => {
      const label = str(form, `part.${i}.label`);
      return label ? [{ label, amountMinor: money(form, `part.${i}.amount`, cur, label), done: form.get(`part.${i}.done`) === 'on' }] : [];
    });
    const savingsItemId = str(form, 'savingsItemId') || null;
    const fields = {
      kind: str(form, 'kind') as (typeof GOAL_KINDS)[number],
      title: str(form, 'title'),
      // With parts the target is their total, so the field may be left as it is or empty.
      targetAmountMinor: parts.length > 0 ? 0 : money(form, 'target', cur, 'Target'),
      currentAmountMinor: money(form, 'current', cur, 'Saved so far'),
      targetDate: str(form, 'targetDate') || undefined,
      priority: Number(str(form, 'priority') || 3),
      fundingOrder: optionalInt(form, 'fundingOrder', 1, 99, 'Place in line') ?? null,
      monthlyCapMinor: optionalMoney(form, 'monthlyCap', cur, 'Most in a month') ?? null,
      savingsItemId,
      parts: parts.length > 0 ? parts : null,
    };
    const id = str(form, 'id');
    if (id) await updateGoal(getCtx(), userId, USER, id, { ...fields, status: str(form, 'status') as GoalStatus }, expectedRevision(form));
    else await createGoal(getCtx(), userId, USER, fields);
  }, 'Saved.');
}

function GoalForm({ goal, savings, currency, revision }: { goal?: Goal; savings: Item[]; currency: string; revision: number }) {
  const parts = goal?.parts ?? [];
  const rows = Math.min(20, parts.length + SPARE_PARTS);
  return (
    <form action={saveGoal} className="mt-3 grid gap-3 sm:grid-cols-2">
      {goal && <input type="hidden" name="id" value={goal.id} />}
      {goal && <input type="hidden" name="revision" value={revision} />}
      <Field label="What is it for?"><input name="title" required maxLength={120} defaultValue={goal?.title} className="input" /></Field>
      <Field label="Type">
        <select name="kind" defaultValue={goal?.kind ?? 'other'} className="input">
          {GOAL_KINDS.map((k) => <option key={k} value={k}>{humanise(k)}</option>)}
        </select>
      </Field>
      <Field label={`Target (${currency})`} hint="If you list parts below, their total is used.">
        <input name="target" inputMode="decimal" defaultValue={goal ? toDecimalString(goal.targetAmountMinor, currency) : ''} className="input" />
      </Field>
      <Field label={`Saved so far (${currency})`} hint={goal?.savingsItemId ? 'Taken from the savings below instead.' : undefined}>
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
      <details className="sm:col-span-2" open={parts.length > 0}>
        <summary className="link cursor-pointer text-sm">What it is made up of (optional)</summary>
        <div className="mt-3 space-y-2">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-center gap-2">
              <input name={`part.${i}.label`} aria-label={`Part ${i + 1}`} placeholder="Part" maxLength={80} defaultValue={parts[i]?.label ?? ''} className="input" />
              <input name={`part.${i}.amount`} aria-label={`Part ${i + 1} amount (${currency})`} placeholder="Amount" inputMode="decimal" defaultValue={parts[i] ? toDecimalString(parts[i].amountMinor, currency) : ''} className="input" />
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name={`part.${i}.done`} defaultChecked={parts[i]?.done ?? false} /> Done</label>
            </div>
          ))}
          <p className="text-xs text-muted">Empty a name to remove that part. Ticking done keeps a note and changes no amounts.</p>
        </div>
      </details>
      <details className="sm:col-span-2" open={!!(goal?.fundingOrder || goal?.monthlyCapMinor != null || goal?.savingsItemId)}>
        <summary className="link cursor-pointer text-sm">How it is funded (optional)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Place in line" hint="1 gets money first. Empty: by priority.">
            <input name="fundingOrder" type="number" min={1} max={99} defaultValue={goal?.fundingOrder ?? ''} className="input" />
          </Field>
          <Field label={`Most in a month (${currency})`} hint="Empty: no limit.">
            <input name="monthlyCap" inputMode="decimal" defaultValue={goal?.monthlyCapMinor != null ? toDecimalString(goal.monthlyCapMinor, currency) : ''} className="input" />
          </Field>
          <Field label="Where the money sits" hint="Its balance is then the progress.">
            <select name="savingsItemId" defaultValue={goal?.savingsItemId ?? ''} className="input">
              <option value="">Not linked</option>
              {goal?.savingsItemId && !savings.some((s) => s.id === goal.savingsItemId) && <option value={goal.savingsItemId}>Savings you removed</option>}
              {savings.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
        </div>
      </details>
      <div className="sm:col-span-2"><button className="btn">{goal ? 'Save changes' : 'Add goal'}</button></div>
    </form>
  );
}

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId, profile } = await requireProfile();
  const { goals: stored, items, summary, scenarios, surplusReliable } = await loadProfileCheck(getCtx(), userId, profile, today());
  const goals = effectiveGoals(stored, items);
  const left = leftOver(summary, scenarios);
  const savings = items.filter((i) => i.kind === 'savings');
  const cur = profile.currency;

  /** What can be said about meeting a goal by its date. Nothing, while the figures it rests on cannot be trusted. */
  const outlook = (goal: Goal) => {
    if (goal.status !== 'active') return null;
    const { verdict, requiredMonthlyMinor } = goalFeasibility(goal, left, today());
    if (verdict === 'date_passed' && goal.targetDate) return { bad: true, text: `Its date, ${formatDay(goal.targetDate)}, has passed.` };
    if (requiredMonthlyMinor === null || !goal.targetDate) return null;
    const needs = `Needs ${formatAmount(requiredMonthlyMinor, cur)} a month until ${formatDay(goal.targetDate)}`;
    if (verdict === 'unreachable') return { bad: true, text: `${needs}, which is more than any month is known to leave over.` };
    if (!surplusReliable) return { bad: false, text: `${needs}.` };
    return { bad: false, text: verdict === 'some_months_only' ? `${needs}. A lean month cannot pay for that; a better one can.` : `${needs}, which each month leaves over.` };
  };

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
              const view = outlook(goal);
              return (
                <li key={goal.id} className="py-3">
                  <details>
                    <summary className="disclosure">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                        <span className="font-medium">{goal.title} {goal.status !== 'active' && <span className="text-xs font-normal text-muted">({goal.status})</span>}</span>
                        <span className="num text-sm text-muted">{formatAmount(goal.currentAmountMinor, cur)} of {formatAmount(goal.targetAmountMinor, cur)} · {pct}%</span>
                      </span>
                      <span className="mt-2 block h-2 overflow-hidden rounded-full bg-paper"><span className="block h-full bg-brand" style={{ width: `${pct}%` }} /></span>
                      {view && <span className={`mt-1.5 block text-sm ${view.bad ? 'text-danger' : 'text-muted'}`}>{view.text}</span>}
                      {goal.parts && <span className="mt-1 block text-sm text-muted">{goal.parts.map((p) => `${p.label}${p.done ? ' (done)' : ''}`).join(', ')}</span>}
                    </summary>
                    <GoalForm goal={stored.find((g) => g.id === goal.id)} savings={savings} currency={cur} revision={profile.revision} />
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        <details className="mt-3">
          <summary className="link cursor-pointer text-sm">Add a goal</summary>
          <GoalForm savings={savings} currency={cur} revision={profile.revision} />
        </details>
      </section>
      <p className="mt-4 text-sm"><Link href="/share-out" className="link">Share out money between bills and goals</Link></p>
    </>
  );
}
