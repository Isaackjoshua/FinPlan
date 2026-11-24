import { monthName } from '@/components/plan-results';
import { Empty, Field, Flash, formatDay, formatPeriod, humanise, PageHeader } from '@/components/ui';
import { money, optionalMoney, run, str, today } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import {
  EXPENSE_CATEGORIES,
  formatAmount,
  getCurrentPlan,
  incomeBand,
  incomeHistory,
  listCheckIns,
  listIncome,
  listItems,
  logCheckIn,
  logIncome,
  setCheckInVoided,
  setIncomeVoided,
  toDecimalString,
  USER,
  type ExcludedReason,
} from '@fin/core';

export const metadata = { title: 'Check-ins' };

async function save(form: FormData) {
  'use server';
  const { userId, profile } = await requireProfile();
  const cur = profile.currency;
  await run('/check-ins', async () => {
    const spending = EXPENSE_CATEGORIES.flatMap((category) => {
      const amountMinor = optionalMoney(form, `spend.${category}`, cur, humanise(category));
      return amountMinor ? [{ category, amountMinor }] : [];
    });
    await logCheckIn(getCtx(), userId, USER, {
      periodStart: str(form, 'periodStart'),
      periodEnd: str(form, 'periodEnd'),
      actuals: {
        incomeMinor: money(form, 'income', cur, 'Income'),
        ...(form.get('noIncome') === 'on' && { noIncome: true }),
        spending,
        debtPaymentsMinor: money(form, 'debt', cur, 'Debt payments'),
        savingsAddedMinor: money(form, 'savings', cur, 'Savings added'),
      },
      note: str(form, 'note') || undefined,
    });
  }, 'Check-in saved.');
}

async function saveIncome(form: FormData) {
  'use server';
  const { userId, profile } = await requireProfile();
  await run('/check-ins', async () => {
    await logIncome(getCtx(), userId, USER, {
      receivedOn: str(form, 'receivedOn'),
      amountMinor: money(form, 'amount', profile.currency, 'Amount'),
      source: str(form, 'source') || undefined,
      itemId: str(form, 'itemId') || undefined,
    });
  }, 'Saved.');
}

/** Takes a record back, or puts it back. Nothing is deleted. */
async function setVoided(form: FormData) {
  'use server';
  const { userId } = await requireProfile();
  const voided = str(form, 'voided') === 'yes';
  await run('/check-ins', () => (str(form, 'what') === 'income' ? setIncomeVoided : setCheckInVoided)(getCtx(), userId, str(form, 'id'), voided), voided ? 'Taken back.' : 'Put back.');
}

function VoidForm({ what, id, voided }: { what: 'income' | 'check-in'; id: string; voided: boolean }) {
  return (
    <form action={setVoided} className="inline">
      <input type="hidden" name="what" value={what} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="voided" value={voided ? 'no' : 'yes'} />
      <button className="cursor-pointer text-xs text-muted hover:underline">{voided ? 'Put back' : 'Take back'}</button>
    </form>
  );
}

const REASONS: Record<ExcludedReason, string> = {
  gap: 'some days have no check-in',
  overlap: 'check-ins overlap',
  crosses_month_end: 'a check-in runs into another month',
  income_not_stated: 'income was left at 0 without saying nothing came in',
};

/** First and last day of the previous calendar month, as YYYY-MM-DD. */
function lastMonth(): [string, string] {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return [iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))), iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)))];
}

export default async function CheckInsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId, profile } = await requireProfile();
  const cur = profile.currency;
  const ctx = getCtx();
  const [checkIns, plan, items, income] = await Promise.all([
    listCheckIns(ctx, userId, 200, { includeVoided: true }),
    getCurrentPlan(ctx, userId),
    listItems(ctx, userId),
    listIncome(ctx, userId, { includeVoided: true, limit: 60 }),
  ]);
  const history = incomeHistory(checkIns.filter((c) => !c.voidedAt), today());
  const band = incomeBand(items, history);
  const sources = items.filter((i) => i.kind === 'income');
  const budgetTotal = plan?.inputs.budget.reduce((sum, row) => sum + row.amountMinor, 0);
  const [start, end] = lastMonth();
  // What was logged as it came in, to start the check-in from.
  const receivedLastMonth = income.filter((r) => !r.voidedAt && r.receivedOn >= start && r.receivedOn <= end).reduce((sum, r) => sum + r.amountMinor, 0);
  return (
    <>
      <PageHeader title="Check-ins">Record what actually happened each month so you and your agent can see how the plan is holding up.</PageHeader>
      <Flash searchParams={searchParams} />

      <section className="card mb-6">
        <details open={checkIns.length === 0}>
          <summary className="disclosure text-lg font-semibold">Log a check-in</summary>
          <form action={save} className="mt-4 space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="From"><input name="periodStart" type="date" required defaultValue={start} className="input" /></Field>
              <Field label="To"><input name="periodEnd" type="date" required defaultValue={end} className="input" /></Field>
              <Field label={`Income received (${cur})`}><input name="income" required inputMode="decimal" defaultValue={receivedLastMonth > 0 ? toDecimalString(receivedLastMonth, cur) : ''} className="input" /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="noIncome" /> Nothing came in (enter 0 above)</label>
            <fieldset>
              <legend className="label">What you spent ({cur})</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {EXPENSE_CATEGORIES.map((category) => (
                  <Field key={category} label={humanise(category)}><input name={`spend.${category}`} inputMode="decimal" className="input" /></Field>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Paid towards debts (${cur})`}><input name="debt" required inputMode="decimal" defaultValue="0" className="input" /></Field>
              <Field label={`Added to savings (${cur})`}><input name="savings" required inputMode="decimal" defaultValue="0" className="input" /></Field>
            </div>
            <Field label="Note (optional)"><textarea name="note" maxLength={1000} rows={2} className="input" /></Field>
            <button className="btn">Save check-in</button>
          </form>
        </details>
      </section>

      <section className="card mb-6">
        <h2 className="text-lg font-semibold">Money received</h2>
        <p className="mb-3 text-sm text-muted">Note money on the day it comes. It fills in your check-in and your cash flow.</p>
        <form action={saveIncome} className="grid gap-3 sm:grid-cols-4">
          <Field label="Date"><input name="receivedOn" type="date" required defaultValue={today()} className="input" /></Field>
          <Field label={`Amount (${cur})`}><input name="amount" required inputMode="decimal" className="input" /></Field>
          <Field label="From (optional)"><input name="source" maxLength={120} className="input" /></Field>
          <Field label="Which income">
            <select name="itemId" defaultValue="" className="input">
              <option value="">Not listed</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-4"><button className="btn">Save</button></div>
        </form>
        {income.length > 0 && (
          <details className="mt-4">
            <summary className="link cursor-pointer text-sm">Latest</summary>
            <ul className="mt-2 divide-y divide-line text-sm">
              {income.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
                  <span className={r.voidedAt ? 'text-muted line-through' : ''}>{formatDay(r.receivedOn)}{r.source && <> · {r.source}</>} {r.loggedBy === 'agent' && <span className="text-xs text-muted">logged by your agent</span>}</span>
                  <span className="flex items-baseline gap-3"><span className={`num ${r.voidedAt ? 'text-muted line-through' : ''}`}>{formatAmount(r.amountMinor, cur)}</span><VoidForm what="income" id={r.id} voided={!!r.voidedAt} /></span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {(history.observed.length > 0 || history.excluded.length > 0) && (
        <section className="card mb-6 text-sm">
          <h2 className="text-lg font-semibold">What your check-ins show about income</h2>
          {history.measured ? (
            <>
              <p className="mt-1 text-muted">
                {history.measured.monthsObserved} {history.measured.monthsObserved === 1 ? 'month' : 'months'} known in full.{' '}
                {band.varies
                  ? band.basis === 'measured'
                    ? 'These figures are now used for planning.'
                    : band.basis === 'provisional'
                      ? 'They fill in what your profile does not say. From six months they are used instead of it.'
                      : 'From three months they start to fill in what your profile does not say.'
                  : 'Your income is recorded as staying the same, so these are for comparison.'}
              </p>
              <dl className="mt-3 grid gap-x-8 sm:grid-cols-3">
                {([['Lowest', history.measured.leanMinor, band.declared.leanMinor], ['Middle', history.measured.typicalMinor, band.declared.typicalMinor], ['Good', history.measured.goodMinor, band.declared.goodMinor]] as const).map(([name, seen, said]) => (
                  <div key={name} className="border-b border-line py-2">
                    <dt className="text-muted">{name} month</dt>
                    <dd className="num font-semibold">{formatAmount(seen, cur)}</dd>
                    <dd className="num text-xs text-muted">Your profile says {said === null ? 'not known' : formatAmount(said, cur)}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="mt-1 text-muted">No month is known in full yet.</p>
          )}
          {history.excluded.length > 0 && (
            <>
              <p className="mt-3 font-medium">Not counted</p>
              <ul className="list-disc pl-5 text-muted">
                {history.excluded.map(({ month, reason }) => <li key={month}>{monthName(month)}: {REASONS[reason]}</li>)}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">History</h2>
        {checkIns.length === 0 ? (
          <Empty>No check-ins yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {checkIns.map((c) => {
              const spent = c.actuals.spending.reduce((sum, row) => sum + row.amountMinor, 0);
              return (
                <li key={c.id} className={`py-3 text-sm ${c.voidedAt ? 'opacity-60' : ''}`}>
                  <p className="font-medium">{formatPeriod(c.periodStart, c.periodEnd)} <span className="ml-1 text-xs font-normal text-muted">logged by {c.loggedBy === 'agent' ? 'your agent' : 'you'}{c.voidedAt && ', taken back'}</span> <VoidForm what="check-in" id={c.id} voided={!!c.voidedAt} /></p>
                  <p className="num mt-1 text-muted">
                    Income {formatAmount(c.actuals.incomeMinor, cur)} · Spent {formatAmount(spent, cur)}
                    {budgetTotal !== undefined && budgetTotal > 0 && <> ({spent > budgetTotal ? `${formatAmount(spent - budgetTotal, cur)} over` : `${formatAmount(budgetTotal - spent, cur)} under`} current budget)</>}
                    {' '}· Debt {formatAmount(c.actuals.debtPaymentsMinor, cur)} · Saved {formatAmount(c.actuals.savingsAddedMinor, cur)}
                  </p>
                  {c.note && <p className="mt-1 whitespace-pre-wrap">{c.note}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
