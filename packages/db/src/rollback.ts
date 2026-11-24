import { createDb } from './index';
import { rollBackLatest } from './migrator';

const url = process.env.DATABASE_URL;
if (!url || !process.argv.includes('--i-have-a-backup')) {
  console.error('Takes back the newest migration, and deletes the data in what it added.\nBack the database up first, then run again with --i-have-a-backup and DATABASE_URL set.');
  process.exit(1);
}
const db = createDb(url);
console.log(`Rolled back ${await rollBackLatest(db)}.`);
await db.close();
