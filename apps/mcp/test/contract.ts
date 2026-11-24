import { readFileSync } from 'node:fs';
import { z } from 'zod';

interface JsonSchema {
  properties?: Record<string, unknown>;
  required?: string[];
}
type Contract = Record<string, { input: JsonSchema; output: JsonSchema }>;

const read = (name: string) => JSON.parse(readFileSync(new URL(`./contract/${name}.json`, import.meta.url), 'utf8')) as Contract;

/**
 * Tool lists as they were released. Never regenerate one: AI apps that connected then check every
 * answer against it. `base` is from before variable income; `variable` is the release that added it.
 */
export const CONTRACTS = { base: read('2026-11'), variable: read('2026-11-variable') };
export const CONTRACT = CONTRACTS.base;

/** What a call asks for that is newer than a release: nothing, what `variable` added, or what came after it. */
export type Asks = 'base' | 'variable' | 'newest';

const validators = Object.fromEntries(
  Object.entries(CONTRACTS).map(([release, contract]) => [release, new Map(Object.entries(contract).map(([name, { output }]) => [name, z.fromJSONSchema(output as never)]))]),
);

/** Throws if an app holding a released tool list that the call fits would reject the answer. Tools added since are not checked. */
export function matchesContract(name: string, answer: unknown, asks: Asks = 'base') {
  if (asks === 'base') validators.base!.get(name)?.parse(answer);
  if (asks !== 'newest') validators.variable!.get(name)?.parse(answer);
}
