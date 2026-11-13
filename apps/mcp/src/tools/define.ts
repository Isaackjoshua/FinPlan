import type { Ctx, Scope } from '@fin/core';
import type { z } from 'zod';

/** Who is calling, established from the access token on this request. */
export interface ToolAuth {
  userId: string;
  connectionId: string;
  scopes: Scope[];
}

export interface Deps {
  ctx: Ctx;
  /** Public address of the web app, for links back to it. */
  appUrl: string;
}

/** What a call touched, by name and id only. This is all the activity log keeps. */
export interface Touched {
  entityType: string;
  entityId?: string;
  changedFields?: string[];
}

export type ToolKind = 'read' | 'catalogue' | 'write' | 'calc';

export interface ToolDef<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  kind: ToolKind;
  /** The permission the token must carry. Null: any valid token will do, because no user data is involved. */
  scope: Scope | null;
  input: I;
  output: O;
  run(args: z.output<I>, auth: ToolAuth, deps: Deps): Promise<{ result: z.input<O>; touched?: Touched }>;
}

/** Declares a tool. Exists so each definition is type-checked against its own schemas. */
export const tool = <I extends z.ZodType, O extends z.ZodType>(def: ToolDef<I, O>) => def as unknown as ToolDef;
