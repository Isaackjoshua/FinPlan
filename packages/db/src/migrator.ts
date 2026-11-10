import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import type { Db } from './index';

/** Kept out of index.ts so application bundles never pull in the migrations folder. */
export async function runMigrations(db: Db) {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
}
