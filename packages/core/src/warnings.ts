import type { Summary } from './summary';

export interface Warning {
  /** Stable identifier, e.g. "spending_exceeds_income". Agents and tests key off this. */
  code: string;
  severity: 'info' | 'warn';
  /** Shown to the user on the dashboard, and later returned to agents after a write. */
  message: string;
}

/**
 * Flags things in a profile that look wrong or risky, so the user (and later their
 * agent) notices before building a plan on top of them.
 *
 * All amounts in `summary` are monthly figures or balances in minor units; compare
 * them as ratios rather than against fixed amounts, since the currency varies.
 */
export function profileWarnings(summary: Summary): Warning[] {
  const warnings: Warning[] = [];
  // TODO(human): decide which conditions deserve a warning and push them here.
  return warnings;
}
