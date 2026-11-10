import { Empty, Field, Flash, humanise, PageHeader } from '@/components/ui';
import { money, percent, run, str } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import {
  archiveItem,
  DEBT_KINDS,
  EXPENSE_CATEGORIES,
  formatAmount,
  FREQUENCIES,
  listItems,
  toDecimalString,
  upsertItem,
  USER,
  type Item,
  type ItemKind,
} from '@fin/core';

export const metadata = { title: 'Profile' };

async function saveItem(form: FormData) {
  'use server';
  const { userId, profile } = await requireProfile();
  const cur = profile.currency;
  await run('/profile', async () => {
    const kind = str(form, 'kind') as ItemKind;
    const base = { id: str(form, 'id') || undefined, label: str(form, 'label') };
    const frequency = str(form, 'frequency') as (typeof FREQUENCIES)[number];
    const input =
      kind === 'income'
        ? { ...base, kind, amountMinor: money(form, 'amount', cur, 'Amount'), frequency }
        : kind === 'expense'
          ? {
              ...base,
              kind,
              amountMinor: money(form, 'amount', cur, 'Amount'),
              frequency,
              category: str(form, 'category') as (typeof EXPENSE_CATEGORIES)[number],
              essential: form.get('essential') === 'on',
            }
          : kind === 'debt'
            ? {
                ...base,
                kind,
                debtKind: str(form, 'debtKind') as (typeof DEBT_KINDS)[number],
                balanceMinor: money(form, 'balance', cur, 'Balance'),
                aprBps: percent(form, 'rate', 'Interest rate'),
                minimumPaymentMinor: money(form, 'minimum', cur, 'Minimum payment'),
              }
            : {
                ...base,
                kind: 'savings' as const,
                balanceMinor: money(form, 'balance', cur, 'Balance'),
                apyBps: percent(form, 'rate', 'Interest rate'),
                isEmergencyFund: form.get('emergency') === 'on',
              };
    await upsertItem(getCtx(), userId, USER, input);
  }, 'Saved.');
}

async function removeItem(form: FormData) {
  'use server';
  const { userId } = await requireProfile();
  await run('/profile', () => archiveItem(getCtx(), userId, USER, str(form, 'id')).then(() => {}), 'Removed.');
}

const SECTIONS: { kind: ItemKind; title: string; blurb: string; add: string }[] = [
  { kind: 'income', title: 'Income', blurb: 'What you take home after tax.', add: 'Add income' },
  { kind: 'expense', title: 'Expenses', blurb: 'Regular spending. Mark the ones you cannot go without as essential.', add: 'Add an expense' },
  { kind: 'debt', title: 'Debts', blurb: 'Loans and balances you owe, with their interest rate.', add: 'Add a debt' },
  { kind: 'savings', title: 'Savings', blurb: 'Money set aside, including your emergency fund.', add: 'Add savings' },
];

function Select({ name, options, value }: { name: string; options: readonly string[]; value?: string }) {
  return (
    <select name={name} defaultValue={value ?? options[0]} className="input">
      {options.map((o) => <option key={o} value={o}>{humanise(o)}</option>)}
    </select>
  );
}

function ItemForm({ kind, item, currency }: { kind: ItemKind; item?: Item; currency: string }) {
  const amount = (minor?: number) => (minor === undefined ? '' : toDecimalString(minor, currency));
  const pct = (bps?: number) => (bps === undefined ? '' : (bps / 100).toString());
  return (
    <form action={saveItem} className="mt-3 grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="kind" value={kind} />
      {item && <input type="hidden" name="id" value={item.id} />}
      <Field label="Name"><input name="label" required maxLength={80} defaultValue={item?.label} className="input" /></Field>

      {(kind === 'income' || kind === 'expense') && (
        <>
          <Field label={`Amount (${currency})`}>
            <input name="amount" required inputMode="decimal" defaultValue={amount(item && 'amountMinor' in item ? item.amountMinor : undefined)} className="input" />
          </Field>
          <Field label="How often"><Select name="frequency" options={FREQUENCIES} value={item && 'frequency' in item ? item.frequency : 'monthly'} /></Field>
        </>
      )}
      {kind === 'expense' && (
        <>
          <Field label="Category"><Select name="category" options={EXPENSE_CATEGORIES} value={item?.kind === 'expense' ? item.category : undefined} /></Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="essential" defaultChecked={item?.kind === 'expense' ? item.essential : true} /> Essential
          </label>
        </>
      )}
      {(kind === 'debt' || kind === 'savings') && (
        <>
          <Field label={`Balance (${currency})`}>
            <input name="balance" required inputMode="decimal" defaultValue={amount(item && 'balanceMinor' in item ? item.balanceMinor : undefined)} className="input" />
          </Field>
          <Field label="Interest rate (% a year)">
            <input name="rate" inputMode="decimal" placeholder="0" defaultValue={pct(item?.kind === 'debt' ? item.aprBps : item?.kind === 'savings' ? item.apyBps : undefined)} className="input" />
          </Field>
        </>
      )}
      {kind === 'debt' && (
        <>
          <Field label="Type"><Select name="debtKind" options={DEBT_KINDS} value={item?.kind === 'debt' ? item.debtKind : undefined} /></Field>
          <Field label={`Minimum monthly payment (${currency})`}>
            <input name="minimum" required inputMode="decimal" defaultValue={amount(item?.kind === 'debt' ? item.minimumPaymentMinor : undefined)} className="input" />
          </Field>
        </>
      )}
      {kind === 'savings' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="emergency" defaultChecked={item?.kind === 'savings' && item.isEmergencyFund} /> This is my emergency fund
        </label>
      )}
      <div className="sm:col-span-2"><button className="btn">{item ? 'Save changes' : 'Add'}</button></div>
    </form>
  );
}

function describe(item: Item, currency: string): string {
  switch (item.kind) {
    case 'income':
      return `${formatAmount(item.amountMinor, currency)} ${item.frequency}`;
    case 'expense':
      return `${formatAmount(item.amountMinor, currency)} ${item.frequency} · ${humanise(item.category)}${item.essential ? ' · essential' : ''}`;
    case 'debt':
      return `${formatAmount(item.balanceMinor, currency)} at ${item.aprBps / 100}% · minimum ${formatAmount(item.minimumPaymentMinor, currency)} a month`;
    case 'savings':
      return `${formatAmount(item.balanceMinor, currency)} at ${item.apyBps / 100}%${item.isEmergencyFund ? ' · emergency fund' : ''}`;
  }
}

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId, profile } = await requireProfile();
  const items = await listItems(getCtx(), userId);
  return (
    <>
      <PageHeader title="Profile">Your current financial picture. Your agent reads this to build your plan, and you can edit it here at any time.</PageHeader>
      <Flash searchParams={searchParams} />
      <div className="space-y-6">
        {SECTIONS.map((section) => {
          const rows = items.filter((i) => i.kind === section.kind);
          return (
            <section key={section.kind} className="card">
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <p className="mb-3 text-sm text-muted">{section.blurb}</p>
              {rows.length === 0 ? (
                <Empty>Nothing here yet.</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  {rows.map((item) => (
                    <li key={item.id} className="py-3">
                      <details>
                        <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4">
                          <span className="font-medium">{item.label}</span>
                          <span className="num text-sm text-muted">{describe(item, profile.currency)}</span>
                        </summary>
                        <ItemForm kind={section.kind} item={item} currency={profile.currency} />
                        <form action={removeItem} className="mt-2">
                          <input type="hidden" name="id" value={item.id} />
                          <button className="text-sm text-danger hover:underline">Remove</button>
                        </form>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
              <details className="mt-3">
                <summary className="link cursor-pointer text-sm">{section.add}</summary>
                <ItemForm kind={section.kind} currency={profile.currency} />
              </details>
            </section>
          );
        })}
      </div>
    </>
  );
}
