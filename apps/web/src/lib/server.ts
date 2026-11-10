import 'server-only';
import { parseMasterKey, type Ctx } from '@fin/core';
import { createDb } from '@fin/db';

const globals = globalThis as { __finCtx?: Ctx };

/** One database pool and master key per process (kept across dev hot reloads). */
export function getCtx(): Ctx {
  if (!globals.__finCtx) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    globals.__finCtx = { db: createDb(url), masterKey: parseMasterKey(process.env.DATA_MASTER_KEY) };
  }
  return globals.__finCtx;
}
