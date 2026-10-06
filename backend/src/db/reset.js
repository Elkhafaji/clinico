import { db } from './knex.js';

try {
  await db.migrate.rollback(undefined, true);
  await db.migrate.latest();
  console.log('Database schema reset and recreated. Run `npm run seed` to provision accounts.');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await db.destroy(); }
