import { readFileSync } from 'node:fs';
import { z } from 'zod';

interface JsonSchema {
  properties?: Record<string, unknown>;
  required?: string[];
}

/**
 * The tool list as it stood in November 2026, before variable income. Never regenerate it:
 * AI apps connected then check every answer against these schemas.
 */
export const CONTRACT = JSON.parse(readFileSync(new URL('./contract/2026-11.json', import.meta.url), 'utf8')) as Record<string, { input: JsonSchema; output: JsonSchema }>;

const validators = new Map(Object.entries(CONTRACT).map(([name, { output }]) => [name, z.fromJSONSchema(output as never)]));

/** Throws if an app holding the older tool list would reject this answer. Tools added since are not checked. */
export function matchesContract(name: string, answer: unknown) {
  validators.get(name)?.parse(answer);
}
