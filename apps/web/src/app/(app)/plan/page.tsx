import { PlanResultsView } from '@/components/plan-results';
import { Empty, Field, Flash, humanise, PageHeader } from '@/components/ui';
import { money, optionalMoney, run, str } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import {
  EXPENSE_CATEGORIES,
  formatAmount,
  listGoals,
  listItems,
  listPlanVersions,
  revertToVersion,
  savePlanVersion,
  toDecimalString,
  toMonthly,
  USER,
  type PlanVersion,
} from '@fin/core';

export const metadata = { title: 'Plan' };

async function saveVersion(form: FormData) {
  'use server';
  const { userId, profile } = await requireProfile();
  const cur = profile.currency;
  await run('/plan', async () => {
    const budget = EXPENSE_CATEGORIES.flatMap((category) => {
      const amountMinor = optionalMoney(form, `budget.${category}`, cur, humanise(category));
      return amountMinor ? [{ category, amountMinor }] : [];
    });
    const goalContributions = form.getAll('goalId').flatMap((goalId) => {
      const amountMinor = optionalMoney(form, `goal.${goalId}`, cur, 'Goal contribution');
      return amountMinor ? [{ goalId: String(goalId), amountMinor }] : [];
    });
    const strategy = str(form, 'debtStrategy');
    const base = str(form, 'baseVersion');
    await savePlanVersion(getCtx(), userId, USER, {
      summary: str(form, 'summary'),
      inputs: {
        budget,
        debtStrategy: strategy === 'snowball' || strategy === 'avalanche' ? strategy : undefined,
        extraDebtPaymentMinor: money(form, 'extraDebt', cur, 'Extra debt payment'),
        emergencyFundMonths: Number(str(form, 'emergencyMonths') || 3),
        goalContributions,
      },
      baseVersion: base ? Number(base) : undefined,
    });
  }, 'New version saved.');
}

async function makeCurrent(form: FormData) {
  'use server';
  const { userId } = await requireProfile();
  const version = Number(str(form, 'version'));
  await run('/plan', () => revertToVersion(getCtx(), userId, version), `Version ${version} is now your current plan.`);
}

const when = (date: Date) => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);

function PlanDetails({ plan, currency, goalTitles: names }: { plan: PlanVersion; currency: string; goalTitles: Map<string, string> }) {
  const goalTitles = names;
  const { inputs } = plan;
  const total = inputs.budget.reduce((sum, row) => sum + row.amountMinor, 0);
  return (
    <div className="space-y-4">
      {/* Summaries may be written by an agent: render as plain text only. */}
      <p className="whitespace-pre-wrap text-sm">{plan.summary}</p>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {inputs.budget.map((row) => (
          <div key={row.category} className="flex justify-between border-b border-line py-1">
            <dt>{humanise(row.category)}</dt>
            <dd className="num">{formatAmount(row.amountMinor, currency)}</dd>
          </div>
        ))}
        <div className="flex justify-between py-1 font-semibold">
          <dt>Monthly budget</dt>
          <dd className="num">{formatAmount(total, currency)}</dd>
        </div>
      </dl>
      <ul className="space-y-1 text-sm text-muted">
        <li>Debt strategy: <span className="text-ink">{inputs.debtStrategy ? humanise(inputs.debtStrategy) : 'None chosen'}</span>
          {inputs.extraDebtPaymentMinor > 0 && <> with <span className="num text-ink">{formatAmount(inputs.extraDebtPaymentMinor, currency)}</span> extra a month</>}
        </li>
        <li>Emergency fund target: <span className="text-ink">{inputs.emergencyFundMonths} months of essentials</span></li>
        {inputs.goalContributions.map((g) => (
          <li key={g.goalId}>{goalTitles.get(g.goalId) ?? 'A goal'}: <span className="num text-ink">{formatAmount(g.amountMinor, currency)}</span> a month</li>
        ))}
      </ul>
      {plan.results && <PlanResultsView results={plan.results} currency={currency} strategy={inputs.debtStrategy} names={names} />}
    </div>
  );
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId, profile } = await requireProfile();
  const ctx = getCtx();
  const cur = profile.currency;
  const [versions, goals, items] = await Promise.all([listPlanVersions(ctx, userId), listGoals(ctx, userId), listItems(ctx, userId)]);
  const expenses = items.filter((i) => i.kind === 'expense');
  const current = versions.find((v) => v.isCurrent);
  // One lookup for every id a plan can mention: goals and debts.
  const goalTitles = new Map([...goals.map((g) => [g.id, g.title] as const), ...items.map((i) => [i.id, i.label] as const)]);
  const activeGoals = goals.filter((g) => g.status === 'active');

  // Start the form from the current plan, or from what the profile says is being spent now.
  const startingBudget = new Map<string, number>();
  if (current) for (const row of current.inputs.budget) startingBudget.set(row.category, row.amountMinor);
  else for (const e of expenses) if (e.kind === 'expense') startingBudget.set(e.category, (startingBudget.get(e.category) ?? 0) + toMonthly(e.amountMinor, e.frequency));
  const startingGoal = new Map(current?.inputs.goalContributions.map((g) => [g.goalId, g.amountMinor]));

  return (
    <>
      <PageHeader title="Plan">Every save creates a new version. Nothing is overwritten, so you can always go back.</PageHeader>
      <Flash searchParams={searchParams} />

      <section className="card mb-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Current plan</h2>
          {current && <p className="text-xs text-muted">Version {current.version} · saved {when(current.savedAt)} by {current.savedBy === 'agent' ? 'your agent' : 'you'}</p>}
        </div>
        {current ? <PlanDetails plan={current} currency={cur} goalTitles={goalTitles} /> : <Empty>No plan yet. Create one below, or connect an agent to build it with you.</Empty>}
      </section>

      <section className="card mb-6">
        <details open={!current}>
          <summary className="cursor-pointer text-lg font-semibold">{current ? 'Create a new version' : 'Create your first plan'}</summary>
          <form action={saveVersion} className="mt-4 space-y-5">
            {current && <input type="hidden" name="baseVersion" value={current.version} />}
            <Field label="What is this plan, in a sentence or two?">
              <textarea name="summary" required maxLength={1000} rows={3} className="input" />
            </Field>
            <fieldset>
              <legend className="label">Monthly budget ({cur})</legend>
              <p className="mb-2 text-xs text-muted">Leave a category empty to leave it out.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {EXPENSE_CATEGORIES.map((category) => (
                  <Field key={category} label={humanise(category)}>
                    <input name={`budget.${category}`} inputMode="decimal" defaultValue={startingBudget.has(category) ? toDecimalString(startingBudget.get(category)!, cur) : ''} className="input" />
                  </Field>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Debt strategy" hint="Snowball: smallest balance first. Avalanche: highest interest first.">
                <select name="debtStrategy" defaultValue={current?.inputs.debtStrategy ?? ''} className="input">
                  <option value="">None</option>
                  <option value="snowball">Snowball</option>
                  <option value="avalanche">Avalanche</option>
                </select>
              </Field>
              <Field label={`Extra debt payment a month (${cur})`}>
                <input name="extraDebt" required inputMode="decimal" defaultValue={toDecimalString(current?.inputs.extraDebtPaymentMinor ?? 0, cur)} className="input" />
              </Field>
              <Field label="Emergency fund target (months)">
                <input name="emergencyMonths" type="number" min={0} max={24} defaultValue={current?.inputs.emergencyFundMonths ?? 3} className="input" />
              </Field>
            </div>
            {activeGoals.length > 0 && (
              <fieldset>
                <legend className="label">Monthly contribution to each goal ({cur})</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {activeGoals.map((goal) => (
                    <Field key={goal.id} label={goal.title}>
                      <input type="hidden" name="goalId" value={goal.id} />
                      <input name={`goal.${goal.id}`} inputMode="decimal" defaultValue={startingGoal.has(goal.id) ? toDecimalString(startingGoal.get(goal.id)!, cur) : ''} className="input" />
                    </Field>
                  ))}
                </div>
              </fieldset>
            )}
            <button className="btn">Save as a new version</button>
          </form>
        </details>
      </section>

      {versions.length > 0 && (
        <section className="card">
          <h2 className="mb-3 text-lg font-semibold">History</h2>
          <ul className="divide-y divide-line">
            {versions.map((v) => (
              <li key={v.version} className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">Version {v.version}</span>
                      {v.isCurrent && <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-dark">Current</span>}
                      <span className="ml-2 text-xs text-muted">{when(v.savedAt)} · {v.savedBy === 'agent' ? 'your agent' : 'you'}</span>
                    </span>
                    {!v.isCurrent && (
                      <form action={makeCurrent}>
                        <input type="hidden" name="version" value={v.version} />
                        <button className="btn-quiet">Make current</button>
                      </form>
                    )}
                  </summary>
                  <div className="mt-3"><PlanDetails plan={v} currency={cur} goalTitles={goalTitles} /></div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
