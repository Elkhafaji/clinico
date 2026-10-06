import assert from 'node:assert/strict';
import { test } from 'node:test';
import knexFactory from 'knex';
import { insertAndGetId } from '../src/db/insert-id.js';
import { up as createSchema } from '../src/db/migrations/001_core.js';

test('insertAndGetId requests RETURNING on PostgreSQL and normalizes its id', async () => {
  let returningColumn;
  const query = {
    client: { config: { client: 'pg' } },
    returning(column) {
      returningColumn = column;
      return Promise.resolve([{ id: '42' }]);
    }
  };

  assert.equal(await insertAndGetId(query), 42);
  assert.equal(returningColumn, 'id');
});

test('insertAndGetId keeps the native id path for SQLite and MySQL', async () => {
  for (const client of ['better-sqlite3', 'mysql2']) {
    const query = Object.assign(Promise.resolve([17]), { client: { config: { client } } });
    assert.equal(await insertAndGetId(query), 17);
  }
});

test('the complete Knex migration compiles for PostgreSQL with timezone-aware timestamps', async (t) => {
  const pg = knexFactory({ client: 'pg' });
  t.after(() => pg.destroy());
  const statements = [];
  const knexWithoutConnection = {
    client: pg.client,
    fn: pg.fn,
    schema: {
      createTable(name, callback) {
        const compiled = pg.schema.createTable(name, callback).toSQL();
        statements.push(...compiled.map((statement) => statement.sql));
        return Promise.resolve();
      }
    }
  };

  await createSchema(knexWithoutConnection);
  const sql = statements.join('\n');
  assert.match(sql, /"start_at" timestamptz not null/);
  assert.match(sql, /"created_at" timestamptz not null/);
  assert.match(sql, /bigserial primary key/);
  assert.match(sql, /"role" text check/);
});
