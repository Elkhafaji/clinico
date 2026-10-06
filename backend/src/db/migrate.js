import { db } from './knex.js';

try {
  const [batch, migrations] = await db.migrate.latest();
  console.log(`Database migration batch ${batch}: ${migrations.length ? migrations.join(', ') : 'already current'}`);
} catch (error) {
  console.error('Database migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
