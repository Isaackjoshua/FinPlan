import { monthName } from '@/components/plan-results';
import { Empty, Field, Flash, PageHeader } from '@/components/ui';
import { FormError, money, run, str, today } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import { confirmAllocation, ConflictError, discardAllocation, formatAmount, listAllocations, listGoals, listItems, proposeAllocation, USER, type Allocation, type AllocationGroup } from '@fin/core';

export const metadata = { title: 'Share out money' };

async function propose(form: FormData) {
  'use server';
  const { userId, profile } = await requireProfile();
  await run('/share-out', async () => {
    const amount = money(form, 'amount', profile.currency, 'Amount');
    await proposeAllocation(getCtx(), userId, USER, amount, today()).catch((error) => {
      throw error instanceof ConflictError ? new FormError('Too many are waiting. Confirm or discard some first.') : error;
    });
  });
}

async function settle(form: FormData) {
  'use server';
  const { userId } = await requireProfile();
  const confirm = str(form, 'action') === 'confirm';
  const settleIt = () =>
    (confirm ? confirmAllocation : discardAllocation)(getCtx(), userId, str(form, 'id')).catch((error) => {
      throw error instanceof ConflictError ? new FormError('Your profile, your goals or what you shared out has changed since this was worked out. Discard it and work it out again.') : error;
    });
  await run('/share-out', settleIt, confirm ? 'Recorded. Your goals and set-asides are up to date.' : 'Taken back.');
}

const GROUPS: Record<AllocationGroup, string> = {
  survival: 'What you cannot live without',
  set_aside: 'Set aside for big bills',
  debt: 'Minimum debt payments',
  committed: 'Commitments',
  goal: 'Goals',
  discretionary: 'Other spending',
};

function SettleButton({ id, action, children, quiet }: { id: string; action: 'confirm' | 'discard'; children: string; quiet?: boolean }) {
  return (
    <form action={settle}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <button className={quiet ? 'btn-quiet' : 'btn'}>{children}</button>
    </form>
  );
}

function Lines({ allocation, names, currency }: { allocation: Allocation; names: Map<string, string>; currency: string }) {
  const groups = Object.entries(GROUPS).flatMap(([group, title]) => {
    const lines = allocation.lines.filter((line) => line.group === group);
    return lines.length > 0 ? [{ group, title, lines }] : [];
  });
  return (
    <div className="space-y-4 text-sm">
      {groups.map(({ group, title, lines }) => (
        <div key={group}>
          <h3 className="font-medium">{title}</h3>
          <ul className="divide-y divide-line">
            {lines.map((line) => (
              <li key={line.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5">
                <span className={line.allocatedMinor === 0 ? 'text-muted' : ''}>{names.get(line.id) ?? 'No longer listed'}</span>
                <span className="num">
                  {formatAmount(line.allocatedMinor, currency)}
                  {line.unmetMinor > 0 && <span className="text-danger"> · {formatAmount(line.unmetMinor, currency)} short</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="flex justify-between border-t border-line pt-2 font-semibold"><span>Left over</span><span className="num">{formatAmount(allocation.leftMinor, currency)}</span></p>
    </div>
  );
}

export default async function ShareOutPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId, profile } = await requireProfile();
  const ctx = getCtx();
  const cur = profile.currency;
  const [items, goals, proposed] = await Promise.all([listItems(ctx, userId), listGoals(ctx, userId), listAllocations(ctx, userId, { status: 'proposed' })]);
  const past = await listAllocations(ctx, userId, { status: 'confirmed', limit: 40 });
  const names = new Map([...items.map((i) => [i.id, i.label] as const), ...goals.map((g) => [g.id, g.title] as const)]);

  return (
    <>
      <PageHeader title="Share out money">When money comes in, see where it goes: what you live on first, then big bills, debts and commitments, then your goals in line.</PageHeader>
      <Flash searchParams={searchParams} />

      <section className="card mb-6">
        <form action={propose} className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-64"><Field label={`How much do you have to share out? (${cur})`}><input name="amount" required inputMode="decimal" className="input" /></Field></div>
          <button className="btn">Work it out</button>
        </form>
        <p className="mt-2 text-xs text-muted">What you have already shared out this month is taken into account. Nothing changes until you confirm.</p>
      </section>

      {proposed.map((a) => (
        <section key={a.id} className="card mb-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Sharing out <span className="num">{formatAmount(a.availableMinor, cur)}</span></h2>
            <p className="text-xs text-muted">{monthName(a.month)} · worked out for {a.madeBy === 'agent' ? 'you by your agent' : 'you'}</p>
          </div>
          <Lines allocation={a} names={names} currency={cur} />
          <div className="mt-4 flex flex-wrap gap-3">
            <SettleButton id={a.id} action="confirm">I have moved the money</SettleButton>
            <SettleButton id={a.id} action="discard" quiet>Discard</SettleButton>
          </div>
        </section>
      ))}

      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">Shared out before</h2>
        {past.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {past.map((a) => (
              <li key={a.id} className="py-3">
                <details>
                  <summary className="disclosure"><span><span className="font-medium">{monthName(a.month)}</span> <span className="num text-sm text-muted">{formatAmount(a.availableMinor, cur)}</span></span></summary>
                  <div className="mt-3 space-y-4"><Lines allocation={a} names={names} currency={cur} /><SettleButton id={a.id} action="discard" quiet>Take this back</SettleButton></div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
