import { afterAll, describe, expect, it } from 'vitest';
import {
  applyProfileChanges,
  checkProfile,
  computePlanResults,
  getProfile,
  incomeBand,
  listItems,
  planInputs,
  recommendLessons,
  restoreProfileRevision,
  savePlanVersion,
  getCurrentPlan,
  setupProfile,
  upsertItem,
  USER,
  type Actor,
  type Item,
} from '../src';
import { groundingItems, income, incompleteItems, rent, food, tzs, variableIncome, variableItems } from './grounding';
import { createUser, testCtx } from './helpers';

const AGENT: Actor = { type: 'agent', connectionId: null };
const codes = (list: { code: string }[]) => list.map((w) => w.code);
const vary = (over: object): Item => ({ ...variableIncome, ...over }) as Item;

describe('incomeBand', () => {
  it('treats fixed income as the same in every kind of month', () => {
    expect(incomeBand([income])).toEqual({ varies: false, basis: 'declared', leanMinor: tzs(200_000), typicalMinor: tzs(200_000), goodMinor: tzs(200_000) });
    expect(incomeBand([])).toMatchObject({ varies: false, leanMinor: 0 });
  });

  it('adds sources up, and knows a total only when every source is known', () => {
    const salary = { ...income, id: 'salary', amountMinor: 120_000, frequency: 'yearly' } as Item;
    expect(incomeBand([salary, vary({ typicalMinor: tzs(300_000), highMinor: tzs(500_000) })])).toEqual({
      varies: true, basis: 'declared', leanMinor: tzs(200_000) + 10_000, typicalMinor: tzs(300_000) + 10_000, goodMinor: tzs(500_000) + 10_000,
    });
    expect(incomeBand([vary({ typicalMinor: tzs(300_000) }), vary({ id: 'other' })])).toMatchObject({ typicalMinor: null, goodMinor: null });
  });
});

describe('checking a profile with income that varies', () => {
  it('states the lean shortfall and what is not known (grounding case)', () => {
    const check = checkProfile(variableItems);
    expect(codes(check.warnings)).toEqual(['lean_month_shortfall', 'income_uncertain', 'low_emergency_fund']);
    expect(check.scenarios).toMatchObject({ breakEvenMinor: tzs(473_500), essentialsBreakEvenMinor: tzs(330_000), leanMonthsCovered: 1, leanMonthsOfEssentialsCovered: 2.3 });
    expect(check.scenarios!.scenarios.map((s) => s.balanceMinor)).toEqual([tzs(-273_500), null, null]);
    expect(check.summary.monthlySurplus).toBe(tzs(-273_500)); // the cautious figure older apps read
    expect(recommendLessons(check.summary, check.warnings, new Set())[0]!.tags).toContain('irregular-income');
  });

  it('changes nothing for fixed income', () => {
    const check = checkProfile(groundingItems);
    expect(check.scenarios).toBeNull();
    expect(codes(check.warnings)).toEqual(['spending_exceeds_income', 'low_emergency_fund']);
  });

  it('says spending exceeds income only when a typical month is known to fall short', () => {
    const withTypical = (shillings: number) => codes(checkProfile(variableItems.map((i) => (i === variableIncome ? vary({ typicalMinor: tzs(shillings) }) : i))).warnings);
    expect(withTypical(473_499)).toEqual(['lean_month_shortfall', 'spending_exceeds_income', 'low_emergency_fund']);
    expect(withTypical(473_500)).toEqual(['lean_month_shortfall', 'low_emergency_fund']);
  });

  it('accepts a lean month of nothing as recorded income', () => {
    const none = checkProfile([vary({ amountMinor: 0 }), rent, food]);
    expect(codes(none.warnings)).toContain('lean_month_shortfall');
    expect(codes(none.warnings)).not.toContain('no_income_recorded');
  });

  it('doubts a surplus in any kind of month when spending looks incomplete', () => {
    const lean = { ...incompleteItems.find((i) => i.id === 'claude')!, amountMinor: tzs(250_000) } as Item;
    const items = (over: object) => [vary(over), lean];
    expect(checkProfile(items({})).surplusReliable).toBe(true); // no month is known to leave anything over
    expect(checkProfile(items({ highMinor: tzs(400_000) })).surplusReliable).toBe(false);
  });
});

describe('planning on income that varies', () => {
  const budget = [
    { category: 'housing', amountMinor: tzs(85_000) },
    { category: 'food', amountMinor: tzs(160_000) },
    { category: 'transport', amountMinor: tzs(55_000) },
    { category: 'utilities', amountMinor: tzs(47_500) },
    { category: 'personal', amountMinor: tzs(126_000) },
  ] as const;
  const plan = (items: Item[], over: object = {}) => computePlanResults(items, [], planInputs.parse({ budget, ...over }), '2026-11');

  it('states the shortfall and its uncertainty rather than one surplus (grounding case)', () => {
    const r = plan(variableItems);
    expect(r.engineVersion).toBe('1.1.0');
    expect(r.scenarios).toMatchObject({ basis: 'declared', omittedSpendingMinor: 0, breakEvenMinor: tzs(473_500) });
    expect(r.scenarios!.scenarios.map((s) => s.balanceMinor)).toEqual([tzs(-273_500), null, null]);
    expect(codes(r.warnings)).toEqual(['lean_month_shortfall', 'income_uncertain']);
  });

  it('still states it when the budget leaves everything out', () => {
    const r = plan(variableItems, { budget: [] });
    expect(r.scenarios).toMatchObject({ omittedSpendingMinor: tzs(473_500), breakEvenMinor: tzs(473_500) });
    expect(codes(r.warnings)).toEqual(['plan_omits_expenses', 'lean_month_shortfall', 'income_uncertain']);
  });

  it('warns that even a typical month cannot pay for the plan', () => {
    const items = variableItems.map((i) => (i === variableIncome ? vary({ typicalMinor: tzs(400_000) }) : i));
    expect(codes(plan(items).warnings)).toEqual(['lean_month_shortfall', 'plan_exceeds_income']);
  });

  it('adds nothing to a plan on fixed income', () => {
    expect(plan(groundingItems)).not.toHaveProperty('scenarios');
    expect(codes(plan(groundingItems).warnings)).toEqual(['plan_exceeds_income']);
  });
});

describe('recording income that varies', () => {
  const ctx = testCtx();
  afterAll(() => ctx.close());
  const user = async () => {
    const id = await createUser(ctx);
    await setupProfile(ctx, id, { country: 'TZ', currency: 'TZS' });
    return id;
  };
  const base = { kind: 'income', label: 'Work', amountMinor: 200, frequency: 'monthly' } as const;
  const stored = async (id: string) => (await listItems(ctx, id))[0]!;

  it('stores fixed income exactly as before', async () => {
    const id = await user();
    const { result } = await upsertItem(ctx, id, USER, { ...base, variability: 'fixed', typicalMinor: null, highMinor: null });
    expect(await stored(id)).toEqual({ id: result, ...base });
  });

  it('keeps what an update does not mention, and clears what it sets to null', async () => {
    const id = await user();
    const { result: itemId } = await upsertItem(ctx, id, USER, { ...base, variability: 'variable', typicalMinor: 300, highMinor: 500 });
    // An app that knows nothing of variable income corrects the label.
    await upsertItem(ctx, id, AGENT, { ...base, id: itemId, label: 'Freelance' });
    expect(await stored(id)).toEqual({ id: itemId, ...base, label: 'Freelance', variability: 'variable', typicalMinor: 300, highMinor: 500 });
    await upsertItem(ctx, id, USER, { ...base, id: itemId, variability: 'variable', typicalMinor: undefined, highMinor: null });
    expect(await stored(id)).toEqual({ id: itemId, ...base, variability: 'variable', typicalMinor: 300 });
    await upsertItem(ctx, id, USER, { ...base, id: itemId, amountMinor: 900, frequency: 'weekly', variability: 'fixed' });
    expect(await stored(id)).toEqual({ id: itemId, ...base, amountMinor: 900, frequency: 'weekly' });
  });

  it('refuses a new amount from a writer that does not say what it means', async () => {
    const id = await user();
    const { result: itemId } = await upsertItem(ctx, id, USER, { ...base, variability: 'variable', typicalMinor: 300 });
    const before = (await getProfile(ctx, id))!.revision;
    await expect(upsertItem(ctx, id, AGENT, { ...base, id: itemId, amountMinor: 250 })).rejects.toThrow(/changing from month to month/);
    await expect(applyProfileChanges(ctx, id, AGENT, { changes: [{ op: 'upsert', id: itemId, item: { ...base, frequency: 'weekly' } }] })).rejects.toThrow(/variable/);
    expect((await getProfile(ctx, id))!.revision).toBe(before);
    await upsertItem(ctx, id, AGENT, { ...base, id: itemId, amountMinor: 250, variability: 'variable' });
    expect(await stored(id)).toMatchObject({ amountMinor: 250, typicalMinor: 300 });
  });

  it('rejects figures out of order, other periods, and a band on fixed income', async () => {
    const id = await user();
    const add = (over: object) => upsertItem(ctx, id, USER, { ...base, ...over });
    await expect(add({ variability: 'variable', typicalMinor: 199 })).rejects.toThrow(/typical month/);
    await expect(add({ variability: 'variable', highMinor: 199 })).rejects.toThrow(/good month/);
    await expect(add({ variability: 'variable', typicalMinor: 300, highMinor: 299 })).rejects.toThrow(/good month/);
    await expect(add({ variability: 'variable', frequency: 'weekly' })).rejects.toThrow(/by the month/);
    await expect(add({ typicalMinor: 300 })).rejects.toThrow(/variable income/);
    // Raising the lean figure past a typical one that was kept.
    const { result: itemId } = await add({ variability: 'variable', typicalMinor: 300 });
    await expect(add({ id: itemId, amountMinor: 301, variability: 'variable' })).rejects.toThrow(/typical month/);
    expect(await listItems(ctx, id)).toHaveLength(1);
  });

  it('comes back when an agent\'s change is undone, and is kept with a saved plan', async () => {
    const id = await user();
    const { result: itemId } = await upsertItem(ctx, id, USER, { ...base, variability: 'variable', typicalMinor: 300 });
    const before = (await getProfile(ctx, id))!.revision;
    await upsertItem(ctx, id, AGENT, { ...base, id: itemId, amountMinor: 900, variability: 'fixed' });
    await restoreProfileRevision(ctx, id, before);
    expect(await stored(id)).toMatchObject({ amountMinor: 200, variability: 'variable', typicalMinor: 300 });

    const saved = await savePlanVersion(ctx, id, USER, { summary: 'Plan', inputs: { budget: [] } });
    expect((await getCurrentPlan(ctx, id))!.results).toEqual(saved.results);
    expect(saved.results.scenarios!.scenarios.map((s) => s.incomeMinor)).toEqual([200, 300, null]);
  });
});
