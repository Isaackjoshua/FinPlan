import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export * as schema from './schema';
export * from 'drizzle-orm/sql';

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return Object.assign(db, { close: () => pool.end() });
}

export type Db = ReturnType<typeof createDb>;
/** A database handle or an open transaction; services accept either. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
