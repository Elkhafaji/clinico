import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'clinico-seed-test-'));
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const databaseFile = path.join(tempDir, 'seed-test.sqlite');
const adminEmail = 'bootstrap-test@example.invalid';
const environment = {
  ...process.env,
  NODE_ENV: 'test',
  DB_CLIENT: 'better-sqlite3',
  DB_FILENAME: databaseFile,
  ADMIN_EMAIL: adminEmail,
  ADMIN_PASSWORD: 'test-only-initial-password-7391',
  ADMIN_NAME: 'Bootstrap Test',
  ADMIN_FORCE_PASSWORD_CHANGE: 'true',
  SEED_DEMO: 'false'
};

async function runScript(relativePath) {
  return execFileAsync(process.execPath, [path.join(backendRoot, relativePath)], { cwd: repoRoot, env: environment });
}

before(async () => {
  await runScript('src/db/migrate.js');
  await runScript('src/db/seed.js');
});

after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test('first seed creates an active admin that must change its initial password', () => {
  const database = new Database(databaseFile, { readonly: true });
  const user = database.prepare('SELECT role, status, must_change_password FROM users WHERE email = ?').get(adminEmail);
  database.close();
  assert.deepEqual(user, { role: 'admin', status: 'active', must_change_password: 1 });
});

test('re-running seed preserves the existing admin and customized settings', async () => {
  const database = new Database(databaseFile);
  const originalHash = database.prepare('SELECT password_hash FROM users WHERE email = ?').get(adminEmail).password_hash;
  database.prepare('UPDATE users SET status = ?, must_change_password = 0 WHERE email = ?').run('suspended', adminEmail);
  database.prepare("UPDATE settings SET value = '{}' WHERE key = 'settings:general'").run();
  database.close();

  await runScript('src/db/seed.js');

  const verify = new Database(databaseFile, { readonly: true });
  const user = verify.prepare('SELECT role, status, must_change_password, password_hash FROM users WHERE email = ?').get(adminEmail);
  const settings = verify.prepare("SELECT value FROM settings WHERE key = 'settings:general'").get().value;
  verify.close();
  assert.equal(user.role, 'admin');
  assert.equal(user.status, 'suspended');
  assert.equal(user.must_change_password, 0);
  assert.equal(user.password_hash, originalHash);
  assert.equal(settings, '{}');
});
