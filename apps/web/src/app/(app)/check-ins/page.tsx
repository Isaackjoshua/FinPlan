import { Empty, Field, Flash, humanise, PageHeader } from '@/components/ui';
import { money, optionalMoney, run, str } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import { EXPENSE_CATEGORIES, formatAmount, getCurrentPlan, listCheckIns, logCheckIn, USER } from '@fin/core';

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
        spending,
        debtPaymentsMinor: money(form, 'debt', cur, 'Debt payments'),
        savingsAddedMinor: money(form, 'savings', cur, 'Savings added'),
      },
      note: str(form, 'note') || undefined,
    });
  }, 'Check-in saved.');
}

/** First and last day of the previous calendar month, as YYYY-MM-DD. */
function lastMonth(): [string, string] {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return [iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))), iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)))];
}

export default async function CheckInsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId, profile } = await requireProfile();
  const cur = profile.currency;
  const [checkIns, plan] = await Promise.all([listCheckIns(getCtx(), userId), getCurrentPlan(getCtx(), userId)]);
  const budgetTotal = plan?.inputs.budget.reduce((sum, row) => sum + row.amountMinor, 0);
  const [start, end] = lastMonth();
  return (
    <>
      <PageHeader title="Check-ins">Record what actually happened each month so you and your agent can see how the plan is holding up.</PageHeader>
      <Flash searchParams={searchParams} />

      <section className="card mb-6">
        <details open={checkIns.length === 0}>
          <summary className="cursor-pointer text-lg font-semibold">Log a check-in</summary>
          <form action={save} className="mt-4 space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="From"><input name="periodStart" type="date" required defaultValue={start} className="input" /></Field>
              <Field label="To"><input name="periodEnd" type="date" required defaultValue={end} className="input" /></Field>
              <Field label={`Income received (${cur})`}><input name="income" required inputMode="decimal" className="input" /></Field>
            </div>
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

      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">History</h2>
        {checkIns.length === 0 ? (
          <Empty>No check-ins yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {checkIns.map((c) => {
              const spent = c.actuals.spending.reduce((sum, row) => sum + row.amountMinor, 0);
              return (
                <li key={c.id} className="py-3 text-sm">
                  <p className="font-medium">{c.periodStart} to {c.periodEnd} <span className="ml-1 text-xs font-normal text-muted">logged by {c.loggedBy === 'agent' ? 'your agent' : 'you'}</span></p>
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
