import { calcTools } from './calc';
import type { ToolDef } from './define';
import { readTools } from './read';
import { writeTools } from './write';

export type { Deps, ToolAuth, ToolDef, ToolKind, Touched } from './define';

/** Every tool the server offers. There is deliberately no tool that deletes, reverts or trades. */
export const TOOLS: readonly ToolDef[] = [...readTools, ...writeTools, ...calcTools];
export const TOOL_BY_NAME: ReadonlyMap<string, ToolDef> = new Map(TOOLS.map((def) => [def.name, def]));
