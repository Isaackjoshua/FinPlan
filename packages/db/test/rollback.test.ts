import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src';
import { rollBackLatest, runMigrations } from '../src/migrator';

// A database of its own: taking tables away under the other tests would break them.
const name = `finplan_rollback_${randomBytes(6).toString('hex')}`;
const url = new URL(process.env.TEST_DATABASE_URL!);
const admin = createDb(url.href);
let db: Db & { close: () => Promise<void> };

beforeAll(async () => {
  await admin.execute(sql.raw(`create database ${name}`));
  url.pathname = `/${name}`;
  db = createDb(url.href);
});
afterAll(async () => {
  await db.close();
  await admin.execute(sql.raw(`drop database ${name}`));
  await admin.close();
});

/** Every column of every table, as the database has it. */
async function shape() {
  const { rows } = await db.execute<{ c: string }>(sql`select table_name || '.' || column_name || ' ' || data_type as c from information_schema.columns where table_schema = 'public' order by 1`);
  return rows.map((row) => row.c);
}

describe('migrations that can be taken back', () => {
  it('go up, down and up again to the same shape', async () => {
    await runMigrations(db);
    const full = await shape();
    expect(full).toEqual(expect.arrayContaining(['check_ins.voided_at timestamp with time zone', 'income_actuals.month text', 'allocations.data text']));

    expect(await rollBackLatest(db)).toBe('0006_allocations');
    expect(await rollBackLatest(db)).toBe('0005_income_actuals');
    expect(await rollBackLatest(db)).toBe('0004_check_in_void');
    const before = await shape();
    expect(before.filter((c) => /voided_at|income_actuals|allocations\./.test(c))).toEqual([]);
    // Nothing older is touched, and what came before has no way down.
    expect(full.filter((c) => before.includes(c))).toEqual(before);
    await expect(rollBackLatest(db)).rejects.toThrow(/no down script/);

    await runMigrations(db);
    expect(await shape()).toEqual(full);
  });
});
