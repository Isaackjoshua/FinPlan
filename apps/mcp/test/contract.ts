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
 * answer against it. `base` is from before variable income; `variable` is the release that added it, and
 * `measured` the one with measured income, big bills and sharing out.
 */
export const CONTRACTS = { base: read('2026-11'), variable: read('2026-11-variable'), measured: read('2026-11-measured') };
export const CONTRACT = CONTRACTS.base;

/** The earliest release that knows everything a call asks for. */
export type Asks = keyof typeof CONTRACTS;
const RELEASES = Object.keys(CONTRACTS) as Asks[];

const validators = Object.fromEntries(
  Object.entries(CONTRACTS).map(([release, contract]) => [release, new Map(Object.entries(contract).map(([name, { output }]) => [name, z.fromJSONSchema(output as never)]))]),
);

/** Throws if an app holding a released tool list that the call fits would reject the answer. Tools added since are not checked. */
export function matchesContract(name: string, answer: unknown, asks: Asks = 'base') {
  for (const release of RELEASES.slice(RELEASES.indexOf(asks))) validators[release]!.get(name)?.parse(answer);
}
