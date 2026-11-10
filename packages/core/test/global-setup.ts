import { createDb, runMigrations } from '@fin/db';
import { existsSync } from 'node:fs';

export default async function setup() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set. Run `pnpm db:up` and copy .env.example to .env.');
  const db = createDb(url);
  await runMigrations(db);
  await db.close();
}
