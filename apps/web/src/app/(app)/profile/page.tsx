import { Empty, Field, Flash, formatDay, humanise, PageHeader } from '@/components/ui';
import { expectedRevision, money, optionalInt, optionalMoney, percent, run, str } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import {
  archiveItem,
  DEBT_KINDS,
  EXPENSE_CATEGORIES,
  EXPENSE_TIERS,
  formatAmount,
  FREQUENCIES,
  listItems,
  lumpyMonths,
  markBillPaid,
  tierOf,
  toDecimalString,
  toMonthly,
  upsertItem,
  USER,
  type ExpenseTier,
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
    const variable = str(form, 'variability') === 'variable';
    const tier = str(form, 'tier') as ExpenseTier;
    const input =
      kind === 'income'
        ? {
            ...base,
            kind,
            amountMinor: money(form, 'amount', cur, 'Amount'),
            // Variable income is recorded by the month, so the form hides how often.
            frequency: variable ? ('monthly' as const) : frequency,
            ...arrivalFields(form, variable ? 'monthly' : frequency),
            variability: variable ? ('variable' as const) : ('fixed' as const),
            ...(variable && {
              typicalMinor: optionalMoney(form, 'typical', cur, 'Typical month') ?? null,
              highMinor: optionalMoney(form, 'high', cur, 'Good month') ?? null,
            }),
          }
        : kind === 'expense'
          ? {
              ...base,
              kind,
              amountMinor: money(form, 'amount', cur, 'Amount'),
              frequency,
              category: str(form, 'category') as (typeof EXPENSE_CATEGORIES)[number],
              essential: tier === 'survival',
              tier,
              nextDueDate: str(form, 'nextDueDate') || null,
              reservedMinor: optionalMoney(form, 'reserved', cur, 'Set aside') || null,
            }
          : kind === 'debt'
            ? {
                ...base,
                kind,
                debtKind: str(form, 'debtKind') as (typeof DEBT_KINDS)[number],
                balanceMinor: money(form, 'balance', cur, 'Balance'),
                aprBps: percent(form, 'rate', 'Interest rate'),
                minimumPaymentMinor: money(form, 'minimum', cur, 'Minimum payment'),
                nextDueDate: str(form, 'nextDueDate') || null,
              }
            : {
                ...base,
                kind: 'savings' as const,
                balanceMinor: money(form, 'balance', cur, 'Balance'),
                apyBps: percent(form, 'rate', 'Interest rate'),
                isEmergencyFund: form.get('emergency') === 'on',
              };
    await upsertItem(getCtx(), userId, USER, input, expectedRevision(form));
  }, 'Saved.');
}

/** When income arrives: days of the month for monthly income, a date for the rest. */
function arrivalFields(form: FormData, frequency: string) {
  if (frequency !== 'monthly') return { arrival: null, nextPayDate: str(form, 'nextPayDate') || null };
  const fromDay = optionalInt(form, 'fromDay', 1, 31, 'Earliest day');
  const toDay = optionalInt(form, 'toDay', 1, 31, 'Latest day');
  const only = fromDay ?? toDay;
  return { arrival: only === undefined ? null : { fromDay: fromDay ?? only, toDay: toDay ?? only }, nextPayDate: null };
}

async function billPaid(form: FormData) {
  'use server';
  const { userId } = await requireProfile();
  await run('/profile', () => markBillPaid(getCtx(), userId, str(form, 'id')).then(() => {}), 'Marked as paid.');
}

async function removeItem(form: FormData) {
  'use server';
  const { userId } = await requireProfile();
  await run('/profile', () => archiveItem(getCtx(), userId, USER, str(form, 'id')).then(() => {}), 'Removed.');
}

const SECTIONS: { kind: ItemKind; title: string; blurb: string; add: string }[] = [
  { kind: 'income', title: 'Income', blurb: 'What you take home after tax. If it changes from month to month, say so and FinPlan plans for the lean months too.', add: 'Add income' },
  { kind: 'expense', title: 'Expenses', blurb: 'Regular spending. Say what you cannot live without: your emergency fund is sized on that alone.', add: 'Add an expense' },
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

function ItemForm({ kind, item, currency, revision }: { kind: ItemKind; item?: Item; currency: string; revision: number }) {
  const amount = (minor?: number) => (minor === undefined ? '' : toDecimalString(minor, currency));
  const pct = (bps?: number) => (bps === undefined ? '' : (bps / 100).toString());
  return (
    <form action={saveItem} className="group/item mt-3 grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="kind" value={kind} />
      {item && <input type="hidden" name="id" value={item.id} />}
      {item && <input type="hidden" name="revision" value={revision} />}
      <Field label="Name"><input name="label" required maxLength={80} defaultValue={item?.label} className="input" /></Field>

      {kind === 'income' && (
        <Field label="Does it change from month to month?">
          <select name="variability" defaultValue={item?.kind === 'income' ? (item.variability ?? 'fixed') : 'fixed'} className="input">
            <option value="fixed">No, it stays the same</option>
            <option value="variable">Yes, it varies</option>
          </select>
        </Field>
      )}
      {(kind === 'income' || kind === 'expense') && (
        <>
          <div>
            <Field label={`Amount (${currency})`}>
              <input name="amount" required inputMode="decimal" defaultValue={amount(item && 'amountMinor' in item ? item.amountMinor : undefined)} className="input" />
            </Field>
            {/* Shown without JavaScript, by what is chosen above. */}
            <p className="mt-1 hidden text-xs text-muted group-has-[option[value=variable]:checked]/item:block">A lean month: the least you can count on. Enter 0 if nothing is certain.</p>
          </div>
          <div className="group-has-[option[value=variable]:checked]/item:hidden">
            <Field label="How often"><Select name="frequency" options={FREQUENCIES} value={item && 'frequency' in item ? item.frequency : 'monthly'} /></Field>
          </div>
        </>
      )}
      {kind === 'income' && (
        <div className="hidden gap-3 group-has-[option[value=variable]:checked]/item:grid sm:col-span-2 sm:grid-cols-2">
          <Field label={`A typical month (${currency})`} hint="Leave empty if you do not know.">
            <input name="typical" inputMode="decimal" defaultValue={amount(item?.kind === 'income' ? (item.typicalMinor ?? undefined) : undefined)} className="input" />
          </Field>
          <Field label={`A good month (${currency})`} hint="Leave empty if you do not know.">
            <input name="high" inputMode="decimal" defaultValue={amount(item?.kind === 'income' ? (item.highMinor ?? undefined) : undefined)} className="input" />
          </Field>
        </div>
      )}
      {kind === 'expense' && (
        <>
          <Field label="Category"><Select name="category" options={EXPENSE_CATEGORIES} value={item?.kind === 'expense' ? item.category : undefined} /></Field>
          <Field label="Could you live without it?">
            <select name="tier" defaultValue={item?.kind === 'expense' ? tierOf(item) : 'survival'} className="input">
              {EXPENSE_TIERS.map((t) => <option key={t} value={t}>{TIERS[t]}</option>)}
            </select>
          </Field>
          <Field label="Next due (optional)" hint="It then repeats as often as chosen above.">
            <input name="nextDueDate" type="date" defaultValue={item?.kind === 'expense' ? (item.nextDueDate ?? '') : ''} className="input" />
          </Field>
          <Field label={`Already set aside for it (${currency}, optional)`}>
            <input name="reserved" inputMode="decimal" defaultValue={amount(item?.kind === 'expense' ? (item.reservedMinor ?? undefined) : undefined)} className="input" />
          </Field>
        </>
      )}
      {kind === 'income' && (
        <details className="sm:col-span-2">
          <summary className="link cursor-pointer text-sm">When it arrives (optional, for your cash flow)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Monthly: earliest day" hint="1 to 31">
              <input name="fromDay" type="number" min={1} max={31} defaultValue={item?.kind === 'income' ? (item.arrival?.fromDay ?? '') : ''} className="input" />
            </Field>
            <Field label="Monthly: latest day" hint="The cash flow counts on this one.">
              <input name="toDay" type="number" min={1} max={31} defaultValue={item?.kind === 'income' ? (item.arrival?.toDay ?? '') : ''} className="input" />
            </Field>
            <Field label="Otherwise: next date">
              <input name="nextPayDate" type="date" defaultValue={item?.kind === 'income' ? (item.nextPayDate ?? '') : ''} className="input" />
            </Field>
          </div>
        </details>
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
          <Field label="Next payment due (optional)">
            <input name="nextDueDate" type="date" defaultValue={item?.kind === 'debt' ? (item.nextDueDate ?? '') : ''} className="input" />
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

const TIERS: Record<ExpenseTier, string> = {
  survival: 'No, I need it to live',
  committed: 'Yes, but it is owed or hard to stop',
  discretionary: 'Yes',
};

const often = (frequency: string) => frequency.replaceAll('_', ' ');

function describe(item: Item, currency: string): string {
  switch (item.kind) {
    case 'income': {
      if (item.variability !== 'variable') return `${formatAmount(item.amountMinor, currency)} ${often(item.frequency)}`;
      const typical = item.typicalMinor == null ? 'typical month not known' : `typically ${formatAmount(item.typicalMinor, currency)}`;
      const high = item.highMinor == null ? '' : `, up to ${formatAmount(item.highMinor, currency)}`;
      return `Varies: at least ${formatAmount(item.amountMinor, currency)} a month, ${typical}${high}`;
    }
    case 'expense': {
      // A bill spread out over months is said to be, so that its real size is not lost.
      const smoothed = lumpyMonths(item.frequency) === null ? '' : `, about ${formatAmount(toMonthly(item.amountMinor, item.frequency), currency)} a month`;
      const due = item.nextDueDate ? ` · due ${formatDay(item.nextDueDate)}` : '';
      return `${formatAmount(item.amountMinor, currency)} ${often(item.frequency)}${smoothed} · ${humanise(item.category)} · ${tierOf(item)}${due}`;
    }
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
                        <summary className="disclosure gap-y-0.5">
                          <span className="font-medium">{item.label}</span>
                          <span className="num text-sm text-muted">{describe(item, profile.currency)}</span>
                        </summary>
                        <ItemForm kind={section.kind} item={item} currency={profile.currency} revision={profile.revision} />
                        <div className="mt-2 flex gap-5">
                          {item.kind === 'expense' && (item.reservedMinor || (item.nextDueDate && lumpyMonths(item.frequency) !== null)) && (
                            <form action={billPaid}>
                              <input type="hidden" name="id" value={item.id} />
                              <button className="link cursor-pointer text-sm">Paid: start on the next one</button>
                            </form>
                          )}
                          <form action={removeItem}>
                            <input type="hidden" name="id" value={item.id} />
                            <button className="cursor-pointer text-sm text-danger hover:underline">Remove</button>
                          </form>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
              <details className="mt-3">
                <summary className="link cursor-pointer text-sm">{section.add}</summary>
                <ItemForm kind={section.kind} currency={profile.currency} revision={profile.revision} />
              </details>
            </section>
          );
        })}
      </div>
    </>
  );
}
