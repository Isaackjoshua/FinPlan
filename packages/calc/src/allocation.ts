import { CalcError, int, MAX_TOTAL } from './util';

export interface AllocationStep {
  id: string;
  /** What is still needed for this. */
  needMinor: number;
  /** The most to put towards it this time; the whole need when left out. */
  capMinor?: number | null;
}

export interface AllocationResult {
  availableMinor: number;
  /** In the order given. `unmetMinor` is what was wanted this time and could not be given. */
  lines: { id: string; wantedMinor: number; allocatedMinor: number; unmetMinor: number }[];
  allocatedMinor: number;
  /** Left once everything has had what it wanted. */
  leftMinor: number;
  /** The first step that could not be given all it wanted; null if every one was. */
  firstUnmetId: string | null;
}

/** Shares out money in order: each step gets what it wants, up to its cap, before the next gets anything. */
export function calcAllocation(input: { availableMinor: number; steps: AllocationStep[] }): AllocationResult {
  const available = int('availableMinor', input.availableMinor);
  if (!Array.isArray(input.steps) || input.steps.length > 10_000) throw new CalcError('invalid_input', 'steps must be a list of at most 10000 items');
  const seen = new Set<string>();
  let left = available;
  const lines = input.steps.map((step, i) => {
    if (typeof step.id !== 'string' || step.id === '' || seen.has(step.id)) throw new CalcError('invalid_input', `steps[${i}].id must be a unique, non-empty string`);
    seen.add(step.id);
    const need = int(`steps[${i}].needMinor`, step.needMinor, MAX_TOTAL);
    const wanted = step.capMinor == null ? need : Math.min(need, int(`steps[${i}].capMinor`, step.capMinor, MAX_TOTAL));
    const allocated = Math.min(wanted, left);
    left -= allocated;
    return { id: step.id, wantedMinor: wanted, allocatedMinor: allocated, unmetMinor: wanted - allocated };
  });
  return {
    availableMinor: available,
    lines,
    allocatedMinor: available - left,
    leftMinor: left,
    firstUnmetId: lines.find((line) => line.unmetMinor > 0)?.id ?? null,
  };
}
