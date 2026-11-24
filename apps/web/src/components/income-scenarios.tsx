import { formatAmount, type ScenariosResult } from '@fin/core';

const NAMES = { lean: 'Lean month', typical: 'Typical month', good: 'Good month' } as const;

/** How a lean, a typical and a good month work out. What is not recorded is shown as not known, never guessed. */
export function ScenarioTable({ result, currency }: { result: ScenariosResult; currency: string }) {
  const money = (minor: number) => formatAmount(Math.abs(minor), currency);
  return (
    <dl className="divide-y divide-line">
      {result.scenarios.map(({ scenario, incomeMinor, balanceMinor }) => (
        <div key={scenario} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
          <dt>
            {NAMES[scenario]}
            {incomeMinor !== null && <span className="num text-muted"> · {formatAmount(incomeMinor, currency)} in</span>}
          </dt>
          {balanceMinor === null ? (
            <dd className="text-muted">Not known</dd>
          ) : (
            <dd className={`num font-semibold ${balanceMinor < 0 ? 'text-danger' : ''}`}>{balanceMinor < 0 ? `${money(balanceMinor)} short` : `${money(balanceMinor)} left over`}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

const months = (n: number) => `${n} lean ${n === 1 ? 'month' : 'months'}`;

/** What it takes to balance, and how long the emergency fund lasts while months stay lean. */
export function ScenarioNotes({ result, currency }: { result: ScenariosResult; currency: string }) {
  const { breakEvenMinor, essentialsBreakEvenMinor, leanMonthsCovered, leanMonthsOfEssentialsCovered } = result;
  return (
    <div className="space-y-1">
      <p>
        A month has to bring in <span className="num font-medium">{formatAmount(breakEvenMinor, currency)}</span> to balance, or{' '}
        <span className="num font-medium">{formatAmount(essentialsBreakEvenMinor, currency)}</span> to cover essentials and minimum debt payments.
      </p>
      {leanMonthsCovered !== null && (
        <p>
          Your emergency fund makes up for {months(leanMonthsCovered)} in full
          {leanMonthsOfEssentialsCovered !== null && <>, or {months(leanMonthsOfEssentialsCovered)} of essentials only</>}. How often lean months come is not known yet.
        </p>
      )}
    </div>
  );
}
