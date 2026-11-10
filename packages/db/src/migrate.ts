import { createDb, runMigrations } from './index';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const db = createDb(url);
await runMigrations(db);
await db.close();
console.log('Migrations applied.');
