import { Empty, Field, Flash, formatDay, PageHeader } from '@/components/ui';
import { money, run, today } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import { cashFlow, formatAmount, listIncome, loadProfileCheck, setCashOnHand, toDecimalString } from '@fin/core';
import Link from 'next/link';

export const metadata = { title: 'Cash flow' };

const DAYS = 62;

async function saveCash(form: FormData) {
  'use server';
  const { userId, profile } = await requireProfile();
  await run('/cash-flow', async () => {
    await setCashOnHand(getCtx(), userId, { amountMinor: money(form, 'amount', profile.currency, 'Amount'), asOf: today() });
  }, 'Saved.');
}

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId, profile } = await requireProfile();
  const cur = profile.currency;
  const ctx = getCtx();
  const day = today();
  const [{ items, band }, receipts] = await Promise.all([loadProfileCheck(ctx, userId, profile, day), listIncome(ctx, userId, { sinceMonth: day.slice(0, 7) })]);
  const cash = profile.cashOnHand;
  const flow = cash && cashFlow(items, { openingMinor: cash.amountMinor, openingAsOf: { date: cash.asOf, recordedAt: cash.recordedAt }, startDate: day, days: DAYS, scenario: 'lean', band, receipts });
  const names = new Map(items.map((i) => [i.id, i.label]));

  return (
    <>
      <PageHeader title="Cash flow">
        A month can balance and still run short before the money comes. This follows your balance day by day for the next two months{band.varies ? ', taking each month as a lean one' : ''}.
      </PageHeader>
      <Flash searchParams={searchParams} />

      <section className="card mb-6">
        <form action={saveCash} className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-64">
            <Field label={`What you can spend today (${cur})`} hint={cash ? `Last entered ${formatDay(cash.asOf)}.` : 'Leave out savings you would not touch.'}>
              <input name="amount" required inputMode="decimal" defaultValue={cash ? toDecimalString(cash.amountMinor, cur) : ''} className="input" />
            </Field>
          </div>
          <button className="btn sm:mb-5">Update</button>
        </form>
        {cash && cash.asOf !== day && <p className="mt-2 text-sm text-warn">This was entered on {formatDay(cash.asOf)} and may have changed. The days below start from it as if it were today&apos;s.</p>}
      </section>

      {!flow ? (
        <Empty>Enter what you can spend today to begin.</Empty>
      ) : (
        <>
          <section className="card mb-6">
            <h2 className="text-sm font-medium text-muted">Lowest point</h2>
            <p className={`num mt-1 text-3xl font-semibold tracking-tight ${flow.lowest.balanceMinor < 0 ? 'text-danger' : 'text-brand'}`}>{formatAmount(flow.lowest.balanceMinor, cur)}</p>
            <p className="mt-1 text-sm text-muted">
              on {formatDay(flow.lowest.date)}.{' '}
              {flow.firstShortDate ? <span className="text-danger">Money runs short on {formatDay(flow.firstShortDate)}.</span> : flow.partial ? 'What has a date is covered.' : 'Every bill is covered.'}{' '}
              By {formatDay(flow.endDate)} you would have {formatAmount(flow.endMinor, cur)}.
            </p>
            {flow.partial && (
              <div className="mt-4 rounded-xl border border-warn/25 bg-warn/5 p-4 text-sm">
                <p className="font-medium text-warn">This is not the whole picture</p>
                {flow.assumedPaid.length > 0 && (
                  <p className="mt-1">{flow.assumedPaid.map((b) => `${names.get(b.id)} (${formatDay(b.date)})`).join(', ')} {flow.assumedPaid.length === 1 ? 'was' : 'were'} due and not marked as paid, so {flow.assumedPaid.length === 1 ? 'it is' : 'they are'} taken as paid. If not, that money is still to go out. <Link href="/profile" className="link">Mark as paid</Link></p>
                )}
                {flow.unmatchedReceiptsMinor > 0 && (
                  <p className="mt-1">{formatAmount(flow.unmatchedReceiptsMinor, cur)} received this month is not linked to one of your incomes, so that income may be counted again.</p>
                )}
                {flow.undated.length > 0 && <p className="mt-1">No date is recorded for {flow.undated.map((u) => names.get(u.id)).join(', ')}, so {flow.undated.length === 1 ? 'it is' : 'they are'} left out. <Link href="/profile" className="link">Add dates</Link></p>}
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="mb-2 text-lg font-semibold">Day by day</h2>
            {flow.points.length === 0 ? (
              <Empty>Nothing with a date falls in this time.</Empty>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {flow.points.map((p) => (
                  <li key={p.date} className="grid grid-cols-[1fr_auto] gap-x-4 py-2">
                    <span><span className="font-medium">{formatDay(p.date)}</span> <span className="block text-muted sm:inline">{p.ids.map((id) => names.get(id)).join(', ')}</span></span>
                    <span className="text-right">
                      <span className={`num block font-semibold ${p.balanceMinor < 0 ? 'text-danger' : ''}`}>{formatAmount(p.balanceMinor, cur)}</span>
                      <span className="num block text-xs text-muted">{p.changeMinor > 0 ? '+' : ''}{formatAmount(p.changeMinor, cur)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-muted">Income that comes between two days is counted on the last, and bills are paid before income on the same day. An estimate for planning, not a prediction.</p>
          </section>
        </>
      )}
    </>
  );
}
