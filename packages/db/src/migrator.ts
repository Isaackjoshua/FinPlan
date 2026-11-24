import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from './index';

const folder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Kept out of index.ts so application bundles never pull in the migrations folder. */
export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: folder });
}

/**
 * Takes back the newest applied migration and returns its name. Removing a table or column
 * removes what it holds, so this needs a backup first. Ordinary rollback does not need it:
 * older code runs on the newer schema, and leaves what it does not know unused.
 */
export async function rollBackLatest(db: Db): Promise<string> {
  const { entries } = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, 'utf8')) as { entries: { tag: string; when: number }[] };
  return db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ created_at: string }>(sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`);
    const latest = entries.find((entry) => entry.when === Number(rows[0]?.created_at));
    if (!latest) throw new Error('The newest applied migration is not one of these');
    const path = `${folder}/down/${latest.tag}.sql`;
    if (!existsSync(path)) throw new Error(`${latest.tag} has no down script`);
    await tx.execute(sql.raw(readFileSync(path, 'utf8')));
    await tx.execute(sql`delete from drizzle.__drizzle_migrations where created_at = ${latest.when}`);
    return latest.tag;
  });
}
