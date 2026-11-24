import { eq, schema } from '@fin/db';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applyProfileChanges, archiveItem, cashFlow, changedSince, checkProfile, computePlanResults, confirmAllocation, createGoal, deleteAccount, discardAllocation, effectiveGoals, expenseTiers, exportUserData, getCurrentPlan, getIncomeHistory, getProfile, getProgress, goalFeasibility, incomeBand, incomeHistory,
  listAllocations, listCheckIns, listGoals, listIncome, listItems, listPlanVersions, loadProfileCheck, logCheckIn, logIncome, markBillPaid, obligations, planInputs, proposeAllocation, restoreProfileRevision, savePlanVersion, setCashOnHand, setCheckInVoided, setIncomeVoided, setupProfile,
  setWarningAcknowledged, shareOut, updateGoal, upsertItem, USER, type Actor, type Goal, type Item,
} from '../src';
import { debt, food, groundingItems, income, rent, savings, tieredItems, tzs, variableIncome, variableItems } from './grounding';
import { createUser, testCtx } from './helpers';

const AGENT: Actor = { type: 'agent', connectionId: null };
const TODAY = '2026-11-24';
const ctx = testCtx();
afterAll(() => ctx.close());
const newUser = async () => {
  const id = await createUser(ctx);
  await setupProfile(ctx, id, { country: 'TZ', currency: 'TZS' });
  return id;
};
const codes = (list: { code: string }[]) => list.map((w) => w.code);
const month = (m: string, incomeMinor: number, over: object = {}) => {
  const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate();
  return { periodStart: `${m}-01`, periodEnd: `${m}-${last}`, actuals: { incomeMinor, spending: [], debtPaymentsMinor: 0, savingsAddedMinor: 0, ...over } };
};

describe('measuring income', () => {
  it('counts only months covered once, in full, and over', () => {
    const h = incomeHistory(
      [
        month('2026-05', 100),
        { ...month('2026-06', 40), periodEnd: '2026-06-15' },
        { ...month('2026-06', 60), periodStart: '2026-06-16' },
        { ...month('2026-07', 10), periodEnd: '2026-07-30' }, // one day short
        month('2026-08', 70), { ...month('2026-08', 5), periodStart: '2026-08-31' }, // the 31st twice
        month('2026-09', 0), // not said
        month('2026-10', 0, { noIncome: true }),
        month('2026-11', 999), // not over yet
      ],
      TODAY,
    );
    expect(h.observed).toEqual([{ month: '2026-05', totalMinor: 100 }, { month: '2026-06', totalMinor: 100 }, { month: '2026-10', totalMinor: 0 }]);
    expect(h.excluded).toEqual([{ month: '2026-07', reason: 'gap' }, { month: '2026-08', reason: 'overlap' }, { month: '2026-09', reason: 'income_not_stated' }]);
    expect(h.runs).toEqual([[100, 100], [0]]);
    expect(h.measured).toMatchObject({ monthsObserved: 3, leanMinor: 0, typicalMinor: 100 });
  });

  it('doubts both months a check-in runs across', () => {
    const h = incomeHistory([month('2026-08', 5), { ...month('2026-08', 5), periodStart: '2026-08-20', periodEnd: '2026-09-05' }, month('2026-09', 5)], TODAY);
    expect(h.excluded).toEqual([{ month: '2026-08', reason: 'crosses_month_end' }, { month: '2026-09', reason: 'crosses_month_end' }]);
    expect(h.measured).toBeNull();
  });

  it('keeps the latest twelve months', () => {
    const months = Array.from({ length: 14 }, (_, i) => month(`${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, i));
    expect(incomeHistory(months, TODAY).observed.map((m) => m.totalMinor)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('doubts every month a long check-in covers', () => {
    const h = incomeHistory([{ ...month('2026-01', 5), periodStart: '2026-01-20', periodEnd: '2026-03-10' }, month('2026-02', 5), month('2026-04', 5)], TODAY);
    expect(h.observed.map((m) => m.month)).toEqual(['2026-04']);
    expect(h.excluded.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('copes with any date and amount that was ever accepted', async () => {
    // Such a date once made this loop for ever.
    expect(incomeHistory([{ ...month('2026-01', 5), periodStart: '9999-12-31', periodEnd: '9999-12-31' }], TODAY).observed).toEqual([]);
    expect(incomeHistory([{ ...month('2026-01', 5), periodStart: '0000-01-01', periodEnd: '9999-12-31' }, month('2026-04', 5)], TODAY).observed).toEqual([]);
    const huge = [{ ...month('2026-01', 6e12), periodEnd: '2026-01-15' }, { ...month('2026-01', 6e12), periodStart: '2026-01-16' }];
    expect(incomeHistory(huge, TODAY).measured).toMatchObject({ leanMinor: 1.2e13 });
    expect(() => checkProfile(variableItems, [], { history: incomeHistory(huge, TODAY), today: TODAY })).not.toThrow();
    const user = await newUser();
    for (const periodStart of ['9999-12-31', '0001-01-01']) await expect(logCheckIn(ctx, user, USER, { ...month('2026-01', 5), periodStart, periodEnd: periodStart })).rejects.toThrow(/between/);
    await expect(logIncome(ctx, user, USER, { receivedOn: '9999-12-31', amountMinor: 5 })).rejects.toThrow(/between/);
    await expect(upsertItem(ctx, user, USER, { ...rent, id: undefined, nextDueDate: '9999-12-31' } as never)).rejects.toThrow(/between/);
    // Goals could be given any date, and some may have been.
    expect(goalFeasibility({ targetDate: '9999-12-31', targetAmountMinor: 5, currentAmountMinor: 0 } as Goal, { leanMinor: 5, typicalMinor: 5, goodMinor: 5 }, TODAY).verdict).toBe('reachable');
    expect(goalFeasibility({ targetDate: '0001-01-01', targetAmountMinor: 5, currentAmountMinor: 0 } as Goal, { leanMinor: 5, typicalMinor: 5, goodMinor: 5 }, TODAY).verdict).toBe('date_passed');
  });

  it('counts a whole year of daily check-ins', async () => {
    const user = await newUser();
    const days = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2025, 10, 1 + i)).toISOString().slice(0, 10));
    await Promise.all(days.map((d) => logCheckIn(ctx, user, USER, { ...month('2026-01', 1), periodStart: d, periodEnd: d })));
    const h = await getIncomeHistory(ctx, user, TODAY);
    expect(h.observed).toHaveLength(12);
    expect(h.excluded).toEqual([]);
  });

  const observed = (...totals: number[]) => incomeHistory(totals.map((t, i) => month(`2026-${String(i + 1).padStart(2, '0')}`, tzs(t))), TODAY);

  it('uses what was declared, then fills its gaps, then takes over', () => {
    expect(incomeBand(variableItems, observed(300_000, 400_000))).toMatchObject({ basis: 'declared', leanMinor: tzs(200_000), typicalMinor: null });
    expect(incomeBand(variableItems, observed(300_000, 400_000, 500_000))).toMatchObject({ basis: 'provisional', leanMinor: tzs(200_000), typicalMinor: tzs(400_000), goodMinor: tzs(500_000) });
    expect(incomeBand(variableItems, observed(300_000, 400_000, 500_000, 350_000, 600_000, 450_000))).toMatchObject({ basis: 'measured', monthsObserved: 6, leanMinor: tzs(300_000), typicalMinor: tzs(425_000), goodMinor: tzs(500_000), belowDeclared: false });
  });

  it('lets a declared figure limit what fills a gap', () => {
    const items = [{ ...variableIncome, highMinor: tzs(350_000) } as Item];
    expect(incomeBand(items, observed(300_000, 400_000, 500_000))).toMatchObject({ typicalMinor: tzs(350_000), goodMinor: tzs(350_000) });
  });

  it('acts at once on a month below the declared floor, without touching the profile', () => {
    const check = checkProfile(variableItems, [], { history: observed(150_000) });
    expect(check.band).toMatchObject({ basis: 'declared', leanMinor: tzs(150_000), belowDeclared: true, declared: { leanMinor: tzs(200_000) } });
    expect(check.summary).toMatchObject({ monthlyIncome: tzs(150_000), monthlySurplus: tzs(-323_500) });
    expect(codes(check.warnings)).toContain('income_below_declared');
  });

  it('leaves fixed income alone, and mentions it when check-ins show much less', () => {
    const enough = observed(190_000, 185_000, 195_000);
    expect(checkProfile(groundingItems, [], { history: enough }).summary).toEqual(checkProfile(groundingItems).summary);
    expect(codes(checkProfile(groundingItems, [], { history: enough }).warnings)).not.toContain('income_lower_than_recorded');
    expect(codes(checkProfile(groundingItems, [], { history: observed(120_000, 150_000, 200_000) }).warnings)).toContain('income_lower_than_recorded');
  });

  it('sizes the buffer on the hole months really dug', () => {
    const history = observed(400_000, 250_000, 200_000, 600_000, 300_000, 330_000);
    const r = computePlanResults(tieredItems, [], planInputs.parse({ budget: [] }), '2026-11', { history });
    // Essentials are 330,000: short 80,000 then 130,000 in a row.
    expect(r.scenarios).toMatchObject({ basis: 'measured', monthsObserved: 6, leanRun: { basis: 'measured', months: 6, amountMinor: tzs(210_000) } });
    const assumed = computePlanResults(tieredItems, [], planInputs.parse({ budget: [], emergencyFundMonths: 6 }), '2026-11');
    expect(assumed.scenarios!.leanRun).toEqual({ basis: 'assumed', months: 6, amountMinor: tzs(780_000) });
  });

  it('stops counting a check-in the user takes back, and reads it again when put back', async () => {
    const user = await newUser();
    const { id } = await logCheckIn(ctx, user, AGENT, month('2026-09', 5));
    expect((await getIncomeHistory(ctx, user, TODAY)).observed).toHaveLength(1);
    await expect(setCheckInVoided(ctx, await newUser(), id, true)).rejects.toThrow(/not found/);
    await setCheckInVoided(ctx, user, id, true);
    expect(await listCheckIns(ctx, user)).toEqual([]);
    expect((await listCheckIns(ctx, user, 5, { includeVoided: true }))[0]!.voidedAt).toBeInstanceOf(Date);
    expect((await getIncomeHistory(ctx, user, TODAY)).observed).toEqual([]);
    expect((await getProgress(ctx, user)).checkIns.count).toBe(0);
    await setCheckInVoided(ctx, user, id, false);
    expect(await listCheckIns(ctx, user)).toHaveLength(1);
    await expect(logCheckIn(ctx, user, USER, month('2026-08', 5, { noIncome: true }))).rejects.toThrow(/does not apply/);
  });

  it('reaches saved plans, which say when the profile has changed since', async () => {
    const user = await newUser();
    for (const { id: _id, ...item } of variableItems) await upsertItem(ctx, user, USER, item);
    for (const m of [4, 5, 6, 7, 8, 9]) await logCheckIn(ctx, user, USER, month(`2026-0${m}`, tzs(100_000 * m)));
    const saved = await savePlanVersion(ctx, user, USER, { summary: 'Plan', inputs: { budget: [] } }, new Date(`${TODAY}T12:00:00Z`));
    expect(saved.results).toMatchObject({ monthly: { incomeMinor: tzs(400_000) }, scenarios: { basis: 'measured' } });
    const plan = (await getCurrentPlan(ctx, user))!;
    expect(changedSince(plan, (await getProfile(ctx, user))!)).toBe(false);
    await upsertItem(ctx, user, USER, { kind: 'savings', label: 'New', balanceMinor: 1, apyBps: 0, isEmergencyFund: false });
    expect(changedSince(plan, (await getProfile(ctx, user))!)).toBe(true);
    expect(changedSince({ results: { ...plan.results!, profileRevision: undefined } }, { revision: 1 })).toBeNull();
  });
});

describe('expense tiers', () => {
  it('sizes the emergency fund on survival spending only (grounding case)', () => {
    expect(expenseTiers(tieredItems)).toEqual({ survivalMinor: tzs(330_000), committedMinor: tzs(143_500), discretionaryMinor: 0, classified: true });
    const r = computePlanResults(tieredItems, [], planInputs.parse({ budget: [], emergencyFundMonths: 6 }), '2026-11');
    expect(r.emergencyFund.targetMinor).toBe(tzs(1_980_000));
    expect(r.spendingTiers).toMatchObject({ committedMinor: tzs(143_500) });
  });

  it('keeps today\'s target until something is classified', () => {
    const all = groundingItems.map((i) => (i.kind === 'expense' ? { ...i, essential: true } : i));
    const r = computePlanResults(all, [], planInputs.parse({ budget: [], emergencyFundMonths: 6 }), '2026-11');
    expect(r.emergencyFund.targetMinor).toBe(tzs(2_841_000));
    expect(r).not.toHaveProperty('spendingTiers');
    expect(codes(checkProfile(all).warnings)).toContain('essential_worth_checking');
    expect(codes(checkProfile(tieredItems).warnings)).not.toContain('essential_worth_checking');
  });

  it('splits a plan into needs and wants by the same rule, once classified', () => {
    const budget = [{ category: 'utilities', amountMinor: tzs(47_500) }, { category: 'personal', amountMinor: tzs(126_000) }, { category: 'health', amountMinor: tzs(1_000) }] as const;
    const needs = (items: Item[]) => computePlanResults(items, [], planInputs.parse({ budget }), '2026-11').budget.buckets[0]!.actualMinor;
    expect(needs(tieredItems)).toBe(tzs(31_000)); // electricity, water, and health, which the profile does not have
    expect(needs(groundingItems)).toBe(tzs(48_500)); // by category, as before
    const twice = computePlanResults(tieredItems, [], planInputs.parse({ budget: [budget[0], budget[0]] }), '2026-11').budget.buckets[0]!.actualMinor;
    expect(twice).toBe(tzs(30_000)); // the same category twice does not double the need
  });

  it('decides "essential", and takes an older writer at its word', async () => {
    const user = await newUser();
    const gym = { kind: 'expense', label: 'Gym', amountMinor: 5, frequency: 'monthly', category: 'personal', essential: true } as const;
    const { result: id } = await upsertItem(ctx, user, USER, { ...gym, tier: 'committed' });
    const now = async () => (await listItems(ctx, user))[0]!;
    expect(await now()).toMatchObject({ essential: false, tier: 'committed' });
    await upsertItem(ctx, user, AGENT, { ...gym, id, essential: false, label: 'The gym' });
    expect(await now()).toMatchObject({ label: 'The gym', tier: 'committed' });
    await upsertItem(ctx, user, AGENT, { ...gym, id });
    expect(await now()).toMatchObject({ essential: true, tier: 'survival' });
    await upsertItem(ctx, user, AGENT, { ...gym, id, essential: false });
    expect(await now()).toMatchObject({ essential: false, tier: 'discretionary' });
  });
});

describe('bills that come less often than monthly', () => {
  const due = (over: object) => [{ ...rent, ...over } as Item, food];
  it('surface with what to set aside (grounding case)', () => {
    const o = obligations(groundingItems, TODAY);
    expect(o).toMatchObject({ setAsideMinor: tzs(85_000), steadyMonthlyMinor: tzs(85_000), smoothedMonthlyMinor: tzs(85_000) });
    expect(o.items).toEqual([expect.objectContaining({ label: 'rent', amountMinor: tzs(255_000), steadyMonthlyMinor: tzs(85_000), dueDate: null, catchUpMonthlyMinor: null })]);
    expect(obligations(due({ nextDueDate: '2027-01-05' }), TODAY)).toMatchObject({ setAsideMinor: tzs(127_500) });
    // Once it is set aside, nothing more is asked for this month.
    expect(obligations(due({ nextDueDate: '2027-01-05', reservedMinor: tzs(127_500) }), TODAY, new Map([['rent', tzs(127_500)]])).setAsideMinor).toBe(0);
    expect(obligations(due({ nextDueDate: '2027-01-05', reservedMinor: tzs(27_500) }), TODAY, new Map([['rent', tzs(27_500)]])).setAsideMinor).toBe(tzs(100_000));
    // Unmarked after its date, what was set aside is spent on it once, and what came since counts.
    expect(obligations(due({ nextDueDate: '2026-11-20', reservedMinor: tzs(355_000) }), TODAY).items[0]).toMatchObject({ dueDatePassed: true, reservedMinor: tzs(100_000), dueDate: '2027-02-20', remainingMinor: tzs(155_000) });
    expect(obligations(due({ nextDueDate: '2027-01-05', reservedMinor: tzs(255_000) }), TODAY).setAsideMinor).toBe(0);
    expect(obligations(due({ frequency: 'every_six_months' }), TODAY).steadyMonthlyMinor).toBe(tzs(42_500));
  });

  it('warn when too little is set aside for one that is coming', () => {
    const raised = (over: object) => codes(checkProfile(due(over), [], { today: TODAY }).warnings).includes('bill_behind');
    expect(raised({ nextDueDate: '2027-01-05' })).toBe(true);
    expect(raised({ nextDueDate: '2027-01-05', reservedMinor: tzs(85_000) })).toBe(false);
    expect(raised({})).toBe(false);
  });

  it('start again once paid', async () => {
    const user = await newUser();
    const { id: _id, ...item } = rent;
    const { result: id } = await upsertItem(ctx, user, USER, { ...item, nextDueDate: '2026-12-01', reservedMinor: tzs(255_000) } as never);
    await markBillPaid(ctx, user, id);
    const [after] = await listItems(ctx, user);
    expect(after).toMatchObject({ nextDueDate: '2027-03-01' });
    expect(after).not.toHaveProperty('reservedMinor');
    // What was set aside beyond the bill stays, and a short month does not move the day for good.
    await upsertItem(ctx, user, USER, { ...item, id, nextDueDate: '2026-11-30', reservedMinor: tzs(300_000) } as never);
    await markBillPaid(ctx, user, id);
    expect((await listItems(ctx, user))[0]).toMatchObject({ nextDueDate: '2027-02-28', reservedMinor: tzs(45_000) });
    await markBillPaid(ctx, user, id);
    expect((await listItems(ctx, user))[0]).toMatchObject({ nextDueDate: '2027-05-30' });
    await upsertItem(ctx, user, USER, { ...item, id, nextDueDate: '2027-06-15' } as never);
    expect((await listItems(ctx, user))[0]).not.toHaveProperty('dueDay');
    await upsertItem(ctx, user, USER, { ...item, id, nextDueDate: '2200-12-31' } as never);
    await expect(markBillPaid(ctx, user, id)).rejects.toThrow(/between/);
    await expect(markBillPaid(ctx, await newUser(), id)).rejects.toThrow(/not found/);
  });

  it('keep their dates when an older writer changes the amount', async () => {
    const user = await newUser();
    const { id: _id, ...item } = rent;
    const { result: id } = await upsertItem(ctx, user, USER, { ...item, nextDueDate: '2026-12-01', reservedMinor: 5 } as never);
    await upsertItem(ctx, user, AGENT, { ...item, id, amountMinor: 9 } as never);
    expect((await listItems(ctx, user))[0]).toMatchObject({ amountMinor: 9, nextDueDate: '2026-12-01', reservedMinor: 5 });
    await upsertItem(ctx, user, USER, { ...item, id, nextDueDate: null, reservedMinor: null } as never);
    expect((await listItems(ctx, user))[0]).not.toHaveProperty('nextDueDate');
  });
});

describe('cash flow', () => {
  const dated: Item[] = [
    { ...income, amountMinor: tzs(400_000), arrival: { fromDay: 20, toDay: 28 } } as Item,
    { ...rent, amountMinor: tzs(250_000), frequency: 'monthly', nextDueDate: '2026-01-05' } as Item,
  ];
  const run = (items: Item[], over: object = {}) => cashFlow(items, { openingMinor: tzs(100_000), openingAsOf: { date: '2026-12-01', recordedAt: '2026-12-01T12:00:00.000Z' }, startDate: '2026-12-01', days: 31, scenario: 'lean', band: incomeBand(items), ...over });

  it('finds the trough when rent is due before the money comes', () => {
    const r = run(dated);
    expect(r).toMatchObject({ endMinor: tzs(250_000), lowest: { date: '2026-12-05', balanceMinor: tzs(-150_000) }, firstShortDate: '2026-12-05', partial: false, undated: [] });
    expect(r.points.map((p) => p.date)).toEqual(['2026-12-05', '2026-12-28']);
  });

  it('lists what has no date instead of placing it', () => {
    expect(run(groundingItems)).toMatchObject({ partial: true, points: [], endMinor: tzs(100_000) });
    expect(run(groundingItems).undated).toHaveLength(9); // income and eight expenses; the debt has no minimum
    expect(run([...dated, { ...debt, minimumPaymentMinor: 5 } as Item]).undated).toEqual([{ id: 'debt', kind: 'debt' }]);
  });

  it('follows weekly pay, debts to their end, and a month that has no 31st', () => {
    const weekly = { ...income, amountMinor: 10, frequency: 'weekly', nextPayDate: '2026-11-27' } as Item;
    expect(run([weekly]).points.map((p) => p.date)).toEqual(['2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25']);
    const owed = { ...debt, balanceMinor: 25, minimumPaymentMinor: 10, nextDueDate: '2026-12-31' } as Item;
    expect(run([owed], { days: 120 }).points.map((p) => [p.date, p.changeMinor])).toEqual([['2026-12-31', -10], ['2027-01-31', -10], ['2027-02-28', -5]]);
    expect(run([{ ...owed, aprBps: 100 } as Item], { days: 150 }).points).toHaveLength(4);
  });

  it('does not expect again what has already come this month', () => {
    const at = (receipts: object[], over: object = {}) => run(dated, { receipts, ...over }).moneyInMinor;
    const got = (amountMinor: number, over: object = {}) => ({ receivedOn: '2026-12-01', loggedAt: new Date('2026-12-01T09:00:00Z'), amountMinor: tzs(amountMinor), ...over });
    expect(at([got(150_000, { itemId: 'income' })])).toBe(tzs(250_000));
    expect(at([got(100_000), got(50_000, { itemId: 'income' })])).toBe(tzs(250_000));
    expect(at([got(999_000)])).toBe(0);
    expect(at([got(150_000, { receivedOn: '2026-11-30' })])).toBe(tzs(400_000));
    // Logged after the balance was entered, so not in it: the money is still to be counted.
    expect(at([got(400_000, { loggedAt: new Date('2026-12-01T18:00:00Z') })])).toBe(tzs(400_000));
    expect(at([got(400_000, { receivedOn: '2026-12-09' })], { startDate: '2026-12-10' })).toBe(tzs(400_000));
    // Received before it was entered, whenever it was logged.
    expect(at([got(400_000, { receivedOn: '2026-12-08', loggedAt: new Date('2026-12-30T00:00:00Z') })], { startDate: '2026-12-10', openingAsOf: { date: '2026-12-10', recordedAt: '2026-12-10T08:00:00.000Z' } })).toBe(0);
  });

  it('does not let one income\'s money stand in for another\'s', () => {
    const second = { ...income, id: 'side', label: 'Side', amountMinor: tzs(150_000), arrival: { fromDay: 30, toDay: 30 } } as Item;
    const receipt = { receivedOn: '2026-12-01', loggedAt: new Date('2026-12-01T09:00:00Z'), amountMinor: tzs(400_000) };
    expect(run([...dated, second], { receipts: [receipt] })).toMatchObject({ moneyInMinor: tzs(550_000), unmatchedReceiptsMinor: tzs(400_000), partial: true });
    expect(run([...dated, second], { receipts: [{ ...receipt, itemId: 'income' }] })).toMatchObject({ moneyInMinor: tzs(150_000), unmatchedReceiptsMinor: 0, partial: false });
  });

  it('says when a big bill is taken as paid because its date has passed', () => {
    const late = { ...rent, nextDueDate: '2026-11-20' } as Item;
    expect(run([late])).toMatchObject({ partial: true, assumedPaid: [{ id: 'rent', date: '2026-11-20' }] });
    expect(run([{ ...late, frequency: 'monthly' } as Item])).toMatchObject({ partial: false, assumedPaid: [] });
  });

  it('takes the kind of month asked for, and a measured lean one', () => {
    const items = [{ ...variableIncome, typicalMinor: tzs(300_000), arrival: { fromDay: 1, toDay: 10 } } as Item];
    expect(run(items).moneyInMinor).toBe(tzs(200_000));
    expect(run(items, { scenario: 'typical' }).moneyInMinor).toBe(tzs(300_000));
    expect(() => run(items, { scenario: 'good' })).toThrow(/not known/);
    const history = incomeHistory([month('2026-10', tzs(120_000))], TODAY);
    expect(run(items, { band: incomeBand(items, history) }).moneyInMinor).toBe(tzs(120_000));
    // Measured months replace what was declared, for every kind of month.
    const measured = incomeBand(items, incomeHistory([250, 300, 325, 325, 400, 500].map((t, i) => month(`2026-0${i + 1}`, tzs(t * 1000))), TODAY));
    expect(['lean', 'typical', 'good'].map((scenario) => run(items, { band: measured, scenario }).moneyInMinor)).toEqual([tzs(250_000), tzs(325_000), tzs(400_000)]);
    expect(run([{ ...variableIncome, arrival: { fromDay: 1, toDay: 10 } } as Item], { band: measured, scenario: 'typical' }).moneyInMinor).toBe(tzs(325_000));
  });

  it('refuses dates that do not suit how often money comes', async () => {
    const user = await newUser();
    const base = { kind: 'income', label: 'Pay', amountMinor: 1 } as const;
    await expect(upsertItem(ctx, user, USER, { ...base, frequency: 'weekly', arrival: { fromDay: 1, toDay: 2 } })).rejects.toThrow(/monthly income/);
    await expect(upsertItem(ctx, user, USER, { ...base, frequency: 'monthly', arrival: { fromDay: 3, toDay: 2 } })).rejects.toThrow(/after the last/);
    await expect(upsertItem(ctx, user, USER, { ...base, frequency: 'monthly', nextPayDate: TODAY })).rejects.toThrow(/days of the month/);
    // A writer that knows of neither can still change how often it comes.
    const { result: id } = await upsertItem(ctx, user, USER, { ...base, frequency: 'monthly', arrival: { fromDay: 1, toDay: 2 } });
    await upsertItem(ctx, user, AGENT, { ...base, id, frequency: 'weekly' });
    expect((await listItems(ctx, user))[0]).toEqual({ ...base, id, frequency: 'weekly' });
  });

  it('starts from what the user says they can spend, which undoing a change leaves alone', async () => {
    const user = await newUser();
    const before = (await getProfile(ctx, user))!.revision;
    await upsertItem(ctx, user, AGENT, { kind: 'income', label: 'Pay', amountMinor: 1, frequency: 'monthly' });
    await setCashOnHand(ctx, user, { amountMinor: 500, asOf: TODAY });
    await restoreProfileRevision(ctx, user, before);
    expect((await getProfile(ctx, user))!.cashOnHand).toMatchObject({ amountMinor: 500, asOf: TODAY });
    await setCashOnHand(ctx, user, null);
    expect((await getProfile(ctx, user))!.cashOnHand).toBeUndefined();
  });

  it('keeps receipts encrypted, and lets the user take one back', async () => {
    const user = await newUser();
    const { id } = await logIncome(ctx, user, AGENT, { receivedOn: '2026-11-03', amountMinor: 717_171, source: 'SENTINEL client' });
    await logIncome(ctx, user, USER, { receivedOn: '2026-11-20', amountMinor: 5 });
    await logIncome(ctx, user, USER, { receivedOn: '2026-09-20', amountMinor: 6 });
    const [row] = await ctx.db.select().from(schema.incomeActuals).where(eq(schema.incomeActuals.id, id));
    expect(JSON.stringify(row)).not.toMatch(/SENTINEL|717171/);
    expect((await listIncome(ctx, user, { sinceMonth: '2026-11' })).map((r) => r.amountMinor)).toEqual([5, 717_171]);
    await expect(setIncomeVoided(ctx, await newUser(), id, true)).rejects.toThrow(/not found/);
    await setIncomeVoided(ctx, user, id, true);
    expect((await listIncome(ctx, user)).map((r) => r.amountMinor)).toEqual([5, 6]);
    expect(await listIncome(ctx, user, { includeVoided: true })).toHaveLength(3);
  });
});

describe('goals', () => {
  const goal = (over: object): Goal => ({ id: 'g', kind: 'purchase', title: 'G', targetAmountMinor: 100, currentAmountMinor: 0, priority: 3, status: 'active', ...over }) as Goal;

  it('take their progress from linked savings, counting no money twice', () => {
    const linked = [goal({ id: 'b', priority: 1, savingsItemId: 'savings' }), goal({ id: 'a', fundingOrder: 1, priority: 5, savingsItemId: 'savings' }), goal({ id: 'c', currentAmountMinor: 7 }), goal({ id: 'd', savingsItemId: 'gone', currentAmountMinor: 9 })];
    const pot = { ...savings, balanceMinor: 130 } as Item;
    expect(effectiveGoals(linked, [pot]).map((g) => [g.id, g.currentAmountMinor])).toEqual([['b', 30], ['a', 100], ['c', 7], ['d', 9]]);
    // Each keeps what was put there for it before the first in line takes the rest.
    const shared = [goal({ id: 'a', fundingOrder: 1, targetAmountMinor: 400, currentAmountMinor: 50, savingsItemId: 'savings' }), goal({ id: 'b', currentAmountMinor: 100, savingsItemId: 'savings' })];
    expect(effectiveGoals(shared, [{ ...savings, balanceMinor: 150 } as Item]).map((g) => g.currentAmountMinor)).toEqual([50, 100]);
    expect(effectiveGoals(shared, [{ ...savings, balanceMinor: 250 } as Item]).map((g) => g.currentAmountMinor)).toEqual([150, 100]);
    expect(effectiveGoals(shared, [{ ...savings, balanceMinor: 20 } as Item]).map((g) => g.currentAmountMinor)).toEqual([20, 0]);
  });

  it('say when their date has passed, rather than that they cost too much', () => {
    const late = goal({ targetDate: '2026-10-01' });
    const rich = [{ ...income, amountMinor: tzs(9_000_000) } as Item, rent, food, ...groundingItems.slice(3)];
    expect(codes(checkProfile(rich, [], { goals: [late], today: TODAY }).warnings)).toEqual(expect.arrayContaining(['goal_date_passed']));
    expect(codes(checkProfile(rich, [], { goals: [late], today: TODAY }).warnings)).not.toContain('goal_unreachable');
  });

  it('are flagged when no month can pay for them (grounding case)', () => {
    const big = goal({ targetAmountMinor: tzs(2_841_000), targetDate: '2027-01-31' });
    const check = checkProfile(variableItems, [], { goals: [big], today: TODAY });
    expect(codes(check.warnings)).toContain('goal_unreachable');
    const raised = (over: object) => codes(checkProfile(variableItems, [], { goals: [{ ...big, ...over }], today: TODAY }).warnings).includes('goal_unreachable');
    expect(raised({ targetDate: undefined })).toBe(false);
    expect(raised({ status: 'paused' })).toBe(false);
    expect(goalFeasibility(goal({ currentAmountMinor: 100 }), { leanMinor: -1, typicalMinor: null, goodMinor: null }, TODAY).verdict).toBe('reached');
  });

  it('can be made of parts, whose total is the target', async () => {
    const user = await newUser();
    const parts = [{ label: 'Case', amountMinor: tzs(200_000) }, { label: 'Battery', amountMinor: tzs(150_000) }, { label: 'Monitor', amountMinor: tzs(200_000) }];
    const { result: id } = await createGoal(ctx, user, USER, { kind: 'purchase', title: 'Equipment', targetAmountMinor: 1, parts });
    const now = async () => (await listGoals(ctx, user))[0]!;
    expect((await now()).targetAmountMinor).toBe(tzs(550_000));
    await expect(updateGoal(ctx, user, AGENT, id, { targetAmountMinor: 5 })).rejects.toThrow(/parts/);
    await updateGoal(ctx, user, AGENT, id, { title: 'Kit', parts: parts.slice(0, 2) });
    expect(await now()).toMatchObject({ title: 'Kit', targetAmountMinor: tzs(350_000) });
    await updateGoal(ctx, user, USER, id, { parts: null, targetAmountMinor: 7 });
    expect(await now()).toMatchObject({ targetAmountMinor: 7 });
    expect(await now()).not.toHaveProperty('parts');
  });

  it('can only be linked to the user\'s own savings', async () => {
    const user = await newUser();
    const { result: theirs } = await upsertItem(ctx, await newUser(), USER, { kind: 'savings', label: 'P', balanceMinor: 1, apyBps: 0, isEmergencyFund: false });
    const make = (savingsItemId: string) => createGoal(ctx, user, USER, { kind: 'other', title: 'G', targetAmountMinor: 5, savingsItemId });
    await expect(make(theirs)).rejects.toThrow(/not found/);
    const { result: pay } = await upsertItem(ctx, user, USER, { kind: 'income', label: 'P', amountMinor: 1, frequency: 'monthly' });
    await expect(make(pay)).rejects.toThrow(/not found/);
    const { result: mine } = await upsertItem(ctx, user, USER, { kind: 'savings', label: 'P', balanceMinor: 4, apyBps: 0, isEmergencyFund: false });
    const { result: id } = await make(mine);
    expect((await getProgress(ctx, user)).goals).toEqual([{ id, status: 'active', percent: 80, remainingMinor: 1 }]);
    await expect(updateGoal(ctx, user, USER, id, { savingsItemId: theirs })).rejects.toThrow(/not found/);
    await expect(updateGoal(ctx, user, AGENT, id, { currentAmountMinor: 3 })).rejects.toThrow(/linked to savings/);
    await updateGoal(ctx, user, AGENT, id, { title: 'Renamed' });
    await updateGoal(ctx, user, USER, id, { savingsItemId: null });
    expect((await getProgress(ctx, user)).goals[0]!.percent).toBe(0);
  });
});

describe('sharing out money', () => {
  const goals: Goal[] = [
    { id: 'monitor', kind: 'purchase', title: 'Monitor', targetAmountMinor: tzs(200_000), currentAmountMinor: 0, priority: 1, status: 'active' },
    { id: 'buffer', kind: 'emergency_fund', title: 'Buffer', targetAmountMinor: tzs(900_000), currentAmountMinor: 0, priority: 3, fundingOrder: 1, monthlyCapMinor: tzs(50_000), status: 'active' },
    { id: 'paused', kind: 'other', title: 'Later', targetAmountMinor: 5, currentAmountMinor: 0, priority: 1, status: 'paused' },
  ];
  const payable = tieredItems.map((i) => (i.kind === 'debt' ? { ...i, minimumPaymentMinor: tzs(10_000) } : i)) as Item[];

  it('goes to survival, big bills, debts, commitments, then goals in line', () => {
    const r = shareOut(payable, goals, tzs(1_000_000), TODAY);
    expect(r.lines.map((l) => [l.group, l.id, l.allocatedMinor / 100])).toEqual([
      ['survival', 'food', 160_000], ['survival', 'transport', 55_000], ['survival', 'electricity', 20_000], ['survival', 'water', 10_000],
      ['set_aside', 'rent', 85_000], ['debt', 'debt', 10_000],
      ['committed', 'claude', 66_000], ['committed', 'data', 17_500], ['committed', 'gym', 60_000],
      ['goal', 'buffer', 50_000], ['goal', 'monitor', 200_000],
    ]);
    expect(r).toMatchObject({ allocatedMinor: tzs(733_500), leftMinor: tzs(266_500) });
  });

  it('stops where the money does (a lean month)', () => {
    const r = shareOut(payable, goals, tzs(200_000), TODAY);
    expect(r.leftMinor).toBe(0);
    expect(r.lines.find((l) => l.id === 'transport')).toMatchObject({ allocatedMinor: tzs(40_000), unmetMinor: tzs(15_000) });
    expect(r.lines.filter((l) => l.group !== 'survival').every((l) => l.allocatedMinor === 0)).toBe(true);
  });

  it('puts unclassified extras after goals, and ignores what needs nothing', () => {
    const fun = { ...food, id: 'fun', essential: false, amountMinor: 5 } as Item;
    expect(shareOut([fun, { ...debt, balanceMinor: 0, minimumPaymentMinor: 5 } as Item], [{ ...goals[0]!, currentAmountMinor: tzs(200_000) }, goals[2]!], 9, TODAY).lines).toEqual([{ group: 'discretionary', id: 'fun', wantedMinor: 5, allocatedMinor: 5, unmetMinor: 0 }]);
  });

  it('leaves big bills the user could do without until last', () => {
    const holiday = { ...rent, id: 'holiday', label: 'Holiday', tier: 'discretionary', essential: false, frequency: 'yearly', amountMinor: tzs(120_000) } as Item;
    const fun = { ...food, id: 'fun', tier: 'discretionary', essential: false, amountMinor: tzs(1_000) } as Item;
    const all = shareOut([holiday, fun, ...payable], goals, tzs(2_000_000), TODAY);
    expect(all.lines.slice(4, 6).map((l) => l.id)).toEqual(['rent', 'debt']);
    expect(all.lines.slice(-2).map((l) => [l.group, l.id, l.allocatedMinor / 100])).toEqual([['discretionary', 'fun', 1_000], ['set_aside', 'holiday', 10_000]]);
    const lean = shareOut([holiday, fun, ...payable], goals, tzs(340_000), TODAY);
    expect(lean.lines.find((l) => l.id === 'debt')!.unmetMinor).toBe(0);
    expect(lean.lines.find((l) => l.id === 'holiday')!.allocatedMinor).toBe(0);
    // Until it is said to be optional by a tier or by not being essential, a bill is one to be ready for.
    expect(shareOut([{ ...holiday, tier: 'committed' } as Item, ...payable], goals, 0, TODAY).lines.filter((l) => l.group === 'set_aside').map((l) => l.id)).toEqual(['holiday', 'rent']);
  });

  async function seeded() {
    const user = await newUser();
    const ids = new Map<string, string>();
    for (const { id, ...item } of payable) ids.set(id, (await upsertItem(ctx, user, USER, { ...item, ...(id === 'rent' && { nextDueDate: '2027-01-05' }) } as never)).result);
    for (const { id, status: _s, ...fields } of goals.slice(0, 2)) ids.set(id, (await createGoal(ctx, user, USER, fields)).result);
    const state = async () => {
      const [items, list] = [await listItems(ctx, user), await listGoals(ctx, user)];
      const reserved = items.find((i) => i.id === ids.get('rent')) as Extract<Item, { kind: 'expense' }>;
      return { rent: (reserved.reservedMinor ?? 0) / 100, buffer: list.find((g) => g.id === ids.get('buffer'))!.currentAmountMinor / 100, monitor: list.find((g) => g.id === ids.get('monitor'))!.currentAmountMinor / 100 };
    };
    return { user, ids, state };
  }

  it('changes nothing until the user confirms, then asks for no more this month', async () => {
    const { user, state } = await seeded();
    const first = await proposeAllocation(ctx, user, AGENT, tzs(500_000), TODAY);
    expect(await state()).toEqual({ rent: 0, buffer: 0, monitor: 0 });
    const [row] = await ctx.db.select().from(schema.allocations).where(eq(schema.allocations.id, first.id));
    expect(row!.data).not.toContain('survival');

    await confirmAllocation(ctx, user, first.id);
    // 245,000 survival, 127,500 for rent, 10,000 debt, then 117,500 of 143,500 committed.
    expect(await state()).toEqual({ rent: 127_500, buffer: 0, monitor: 0 });
    await expect(confirmAllocation(ctx, user, first.id)).rejects.toThrow(/already/);

    const second = await proposeAllocation(ctx, user, USER, tzs(100_000), TODAY);
    expect(second.lines.filter((l) => l.allocatedMinor > 0).map((l) => [l.group, l.allocatedMinor / 100])).toEqual([['committed', 26_000], ['goal', 50_000], ['goal', 24_000]]);
    await confirmAllocation(ctx, user, second.id);
    expect(await state()).toEqual({ rent: 127_500, buffer: 50_000, monitor: 24_000 });
    // The cap counts for the month: the buffer is not offered more.
    expect((await proposeAllocation(ctx, user, USER, tzs(1), TODAY)).lines.map((l) => l.group)).toEqual(['goal']);

    await discardAllocation(ctx, user, second.id);
    expect(await state()).toEqual({ rent: 127_500, buffer: 0, monitor: 0 });
    await expect(discardAllocation(ctx, user, second.id)).rejects.toThrow(/not found/);
    await expect(confirmAllocation(ctx, await newUser(), first.id)).rejects.toThrow(/not found/);
  });

  it('refuses to confirm two that were worked out side by side', async () => {
    const { user, state } = await seeded();
    const [a, b] = [await proposeAllocation(ctx, user, USER, tzs(400_000), TODAY), await proposeAllocation(ctx, user, USER, tzs(400_000), TODAY)];
    await confirmAllocation(ctx, user, a.id);
    const after = await state();
    await expect(confirmAllocation(ctx, user, b.id)).rejects.toThrow(/revision/);
    expect(await state()).toEqual(after);
    await discardAllocation(ctx, user, b.id);
    expect(await state()).toEqual(after);
    expect((await listAllocations(ctx, user, { month: '2026-11' })).map((x) => x.status)).toEqual(['discarded', 'confirmed']);
  });

  it('is undone and redone with the balances it changed', async () => {
    const { user, state } = await seeded();
    const a = await proposeAllocation(ctx, user, USER, tzs(700_000), TODAY);
    const before = (await getProfile(ctx, user))!.revision;
    await confirmAllocation(ctx, user, a.id);
    const given = await state();
    const { revision } = await restoreProfileRevision(ctx, user, before);
    expect(await state()).toEqual({ rent: 0, buffer: 0, monitor: 0 });
    expect((await listAllocations(ctx, user))[0]!.status).toBe('discarded');
    await restoreProfileRevision(ctx, user, revision - 1);
    expect(await state()).toEqual(given);
    expect((await listAllocations(ctx, user))[0]!.status).toBe('confirmed');
  });

  it('adds to the savings a goal is linked to', async () => {
    const { user, ids } = await seeded();
    await updateGoal(ctx, user, USER, ids.get('buffer')!, { savingsItemId: ids.get('savings')! });
    await confirmAllocation(ctx, user, (await proposeAllocation(ctx, user, USER, tzs(533_500), TODAY)).id);
    const pot = (await listItems(ctx, user)).find((i) => i.id === ids.get('savings'))!;
    // The pot already holds 300,000 of the buffer's 900,000; 7,500 is left for it after rent's 127,500.
    expect(pot).toMatchObject({ balanceMinor: tzs(307_500) });
  });

  it('is refused once anything it rests on has changed, even in another month', async () => {
    const { user, ids, state } = await seeded();
    const old = await proposeAllocation(ctx, user, USER, tzs(900_000), '2026-10-31');
    await updateGoal(ctx, user, USER, ids.get('monitor')!, { currentAmountMinor: tzs(200_000) });
    await expect(confirmAllocation(ctx, user, old.id)).rejects.toThrow(/revision/);
    expect(await state()).toMatchObject({ monitor: 200_000, rent: 0 });
    // Saying what can be spent today changes nothing it rests on.
    const fresh = await proposeAllocation(ctx, user, USER, tzs(900_000), TODAY);
    await setCashOnHand(ctx, user, { amountMinor: 5, asOf: TODAY });
    await confirmAllocation(ctx, user, fresh.id);
  });

  it('takes back exactly what it changed, whatever the goal is linked to by then', async () => {
    const { user, ids, state } = await seeded();
    const balance = async () => (await listItems(ctx, user)).flatMap((i) => (i.id === ids.get('savings') && i.kind === 'savings' ? [i.balanceMinor / 100] : []))[0];
    const a = await proposeAllocation(ctx, user, USER, tzs(900_000), TODAY);
    await confirmAllocation(ctx, user, a.id);
    expect(await state()).toMatchObject({ buffer: 50_000 });
    await updateGoal(ctx, user, USER, ids.get('buffer')!, { savingsItemId: ids.get('savings')! });
    await discardAllocation(ctx, user, a.id);
    expect(await state()).toEqual({ rent: 0, buffer: 0, monitor: 0 });
    expect(await balance()).toBe(300_000);

    // Linked when it was confirmed, not linked when it is taken back.
    const b = await proposeAllocation(ctx, user, USER, tzs(900_000), TODAY);
    await confirmAllocation(ctx, user, b.id);
    expect(await balance()).toBe(350_000);
    await updateGoal(ctx, user, USER, ids.get('buffer')!, { savingsItemId: null });
    await discardAllocation(ctx, user, b.id);
    expect(await balance()).toBe(300_000);
    expect(await state()).toEqual({ rent: 0, buffer: 0, monitor: 0 });
  });

  it('credits a goal itself when the savings it was linked to have been removed', async () => {
    const { user, ids, state } = await seeded();
    await updateGoal(ctx, user, USER, ids.get('buffer')!, { savingsItemId: ids.get('savings')! });
    await archiveItem(ctx, user, USER, ids.get('savings')!);
    const a = await proposeAllocation(ctx, user, USER, tzs(900_000), TODAY);
    await confirmAllocation(ctx, user, a.id);
    expect(await state()).toMatchObject({ buffer: 50_000 });
    expect(effectiveGoals(await listGoals(ctx, user), await listItems(ctx, user)).find((g) => g.id === ids.get('buffer'))!.currentAmountMinor).toBe(tzs(50_000));
    expect((await listAllocations(ctx, user, { id: a.id }))[0]!.made!.some((m) => m.to === 'savings')).toBe(false);
  });

  it('is not hidden by a pile of proposals, and the pile is limited', async () => {
    const { user } = await seeded();
    const a = await proposeAllocation(ctx, user, USER, tzs(245_000), TODAY);
    await confirmAllocation(ctx, user, a.id);
    for (let i = 0; i < 20; i++) await proposeAllocation(ctx, user, AGENT, 1, TODAY);
    await expect(proposeAllocation(ctx, user, AGENT, 1, TODAY)).rejects.toThrow(/waiting/);
    expect(await listAllocations(ctx, user, { status: 'confirmed', limit: 1 })).toHaveLength(1);
    await discardAllocation(ctx, user, a.id);
  });
});

describe('what belongs to the user', () => {
  it('includes the new records in the export and the deletion', async () => {
    const user = await newUser();
    await logIncome(ctx, user, USER, { receivedOn: '2026-11-03', amountMinor: 919_191 });
    const { id } = await logCheckIn(ctx, user, USER, month('2026-09', 828_282));
    await setCheckInVoided(ctx, user, id, true);
    await proposeAllocation(ctx, user, USER, 737_373, TODAY);
    const exported = JSON.stringify(await exportUserData(ctx, user));
    for (const amount of ['919191', '828282', '737373']) expect(exported).toContain(amount);
    await deleteAccount(ctx, user);
    for (const table of [schema.incomeActuals, schema.allocations, schema.checkIns]) expect(await ctx.db.select().from(table).where(eq(table.userId, user))).toEqual([]);
  });

  it('is loaded in one go for a check', async () => {
    const user = await newUser();
    await applyProfileChanges(ctx, user, AGENT, { changes: [{ op: 'upsert', item: { kind: 'income', label: 'Work', amountMinor: 5, frequency: 'monthly' } }] });
    const check = await loadProfileCheck(ctx, user, (await getProfile(ctx, user))!, TODAY);
    expect(check).toMatchObject({ goals: [], history: { observed: [] }, band: { varies: false }, surplusReliable: false });
    expect(await listPlanVersions(ctx, user)).toEqual([]);
  });
});

describe('things the user says that change no figure', () => {
  it('do not make a plan look out of date', async () => {
    const user = await newUser();
    await savePlanVersion(ctx, user, USER, { summary: 'P', inputs: { budget: [] } });
    const before = (await getProfile(ctx, user))!.revision;
    await setCashOnHand(ctx, user, { amountMinor: 5, asOf: TODAY });
    await setWarningAcknowledged(ctx, user, 'no_food_recorded', true);
    const profile = (await getProfile(ctx, user))!;
    expect(profile).toMatchObject({ revision: before, cashOnHand: { amountMinor: 5 }, acknowledgedWarnings: ['no_food_recorded'] });
    expect(changedSince((await getCurrentPlan(ctx, user))!, profile)).toBe(false);
  });
});
