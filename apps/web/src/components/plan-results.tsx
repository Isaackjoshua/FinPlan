import { formatAmount, type PlanResults } from '@fin/core';

/** "2027-01" -> "January 2027" */
export function monthName(month: string): string {
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}

const duration = (months: number) => {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [years && `${years} year${years === 1 ? '' : 's'}`, rest && `${rest} month${rest === 1 ? '' : 's'}`].filter(Boolean);
  return parts.join(', ') || 'no time';
};

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'bad' }) {
  return (
    <div className={`flex justify-between border-b border-line py-1 ${strong ? 'font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd className={`num ${tone === 'bad' ? 'text-danger' : ''}`}>{value}</dd>
    </div>
  );
}

export function PlanResultsView({
  results,
  currency,
  strategy,
  names,
}: {
  results: PlanResults;
  currency: string;
  strategy?: 'snowball' | 'avalanche';
  /** Display names for debt and goal ids. */
  names: Map<string, string>;
}) {
  const money = (minor: number) => formatAmount(minor, currency);
  const { monthly, debt, emergencyFund, goals, warnings } = results;
  const chosen = debt ? debt[strategy ?? 'avalanche'] : null;
  const other = debt ? debt[(strategy ?? 'avalanche') === 'avalanche' ? 'snowball' : 'avalanche'] : null;

  return (
    <div className="space-y-4 rounded-lg bg-paper p-4 text-sm">
      <h3 className="font-semibold">What this plan works out to</h3>

      {warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-warn">
          {warnings.map((w) => <li key={w.code}>{w.message}</li>)}
        </ul>
      )}

      <dl>
        <Row label="Monthly income" value={money(monthly.incomeMinor)} />
        <Row label="Budgeted spending" value={money(monthly.budgetedSpendingMinor)} />
        <Row label="Debt payments" value={money(monthly.debtPaymentsMinor)} />
        <Row label="Towards goals" value={money(monthly.goalContributionsMinor)} />
        <Row
          strong
          label={monthly.unallocatedMinor < 0 ? 'Over income by' : 'Not yet allocated'}
          value={money(Math.abs(monthly.unallocatedMinor))}
          tone={monthly.unallocatedMinor < 0 ? 'bad' : undefined}
        />
      </dl>

      {chosen && (
        <div>
          <p className="font-medium">Debt</p>
          {chosen.feasible ? (
            <>
              <p>
                Debt-free in <span className="font-medium">{duration(chosen.monthsToDebtFree)}</span>
                {chosen.debtFreeMonth && <> ({monthName(chosen.debtFreeMonth)})</>}, paying <span className="num font-medium">{money(chosen.totalInterestMinor)}</span> in interest.
              </p>
              {chosen.priorityOrder.length > 1 && (
                <p className="text-muted">Order: {chosen.priorityOrder.map((id) => names.get(id) ?? 'a debt').join(', then ')}.</p>
              )}
              {other?.feasible && other.totalInterestMinor !== chosen.totalInterestMinor && (
                <p className="text-muted">
                  {other.strategy === 'avalanche' ? 'Avalanche' : 'Snowball'} would cost{' '}
                  <span className="num">{money(Math.abs(other.totalInterestMinor - chosen.totalInterestMinor))}</span>{' '}
                  {other.totalInterestMinor < chosen.totalInterestMinor ? 'less' : 'more'} in interest and take {duration(other.monthsToDebtFree)}.
                </p>
              )}
            </>
          ) : (
            <p className="text-danger">
              {chosen.reason === 'budget_below_minimums'
                ? `The minimum payments need at least ${money(chosen.minimumBudgetMinor)} a month.`
                : 'At this rate the debt is never paid off.'}
            </p>
          )}
        </div>
      )}

      <div>
        <p className="font-medium">Emergency fund</p>
        <p>
          Target <span className="num font-medium">{money(emergencyFund.targetMinor)}</span>
          {emergencyFund.monthsCovered !== null && <>; you have {emergencyFund.monthsCovered} {emergencyFund.monthsCovered === 1 ? 'month' : 'months'} of essentials now</>}.{' '}
          {emergencyFund.gapMinor === 0
            ? 'Target met.'
            : emergencyFund.targetReachedMonth
              ? `Reached in ${monthName(emergencyFund.targetReachedMonth)}.`
              : 'Nothing is being set aside for it in this plan.'}
        </p>
      </div>

      {goals.length > 0 && (
        <div>
          <p className="font-medium">Goals</p>
          <ul>
            {goals.map((g) => (
              <li key={g.goalId}>
                {names.get(g.goalId) ?? 'A goal'}:{' '}
                {g.monthsToTarget === 0 ? 'already reached' : g.targetReachedMonth ? `reached in ${monthName(g.targetReachedMonth)}` : 'not reached within 50 years'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted">
        Projections assume fixed interest rates charged monthly, no fees, and that your income and spending stay as
        recorded. They are estimates for planning, not predictions or advice.
      </p>
    </div>
  );
}
