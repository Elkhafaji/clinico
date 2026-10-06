import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

const sandbox = await mkdtemp(path.join(os.tmpdir(), 'clinico-vercel-files-test-'));
process.env.NODE_ENV = 'test';
process.env.VERCEL = '1';
process.env.DB_CLIENT = 'better-sqlite3';
process.env.DB_FILENAME = path.join(sandbox, 'test.sqlite');
process.env.FILE_STORAGE_ENABLED = 'false';

const { db } = await import('../src/db/knex.js');
const { default: app } = await import('../src/app.js');

after(async () => {
  await db.destroy();
  await rm(sandbox, { recursive: true, force: true });
});

test('medical file routes return a clear unavailable response when storage is disabled', async () => {
  const response = await request(app).post('/api/v1/files');
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'FILE_STORAGE_DISABLED');
});
