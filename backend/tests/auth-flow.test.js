import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import bcrypt from 'bcryptjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { insertAndGetId } from '../src/db/insert-id.js';

const sandbox = await mkdtemp(path.join(os.tmpdir(), 'clinico-auth-test-'));
process.env.NODE_ENV = 'test';
process.env.DB_CLIENT = 'better-sqlite3';
process.env.DB_FILENAME = path.join(sandbox, 'auth.sqlite');
process.env.UPLOAD_DIR = path.join(sandbox, 'uploads');
process.env.BACKUP_DIR = path.join(sandbox, 'backups');
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'auth-flow-test-access-secret-32-characters';
process.env.JWT_REFRESH_SECRET = 'auth-flow-test-refresh-secret-32-characters';

const { db } = await import('../src/db/knex.js');
const { default: app } = await import('../src/app.js');

let adminEmail;
const adminPassword = 'admin-flow-test-password-2026';

before(async () => {
  await db.migrate.latest();
  const clinicId = await insertAndGetId(db('clinics').insert({ name: 'Auth test clinic', timezone: 'Africa/Cairo', currency: 'EGP' }));
  adminEmail = 'admin-auth-test@example.invalid';
  await insertAndGetId(db('users').insert({
    clinic_id: clinicId,
    role: 'admin',
    full_name: 'Auth Test Admin',
    email: adminEmail,
    password_hash: await bcrypt.hash(adminPassword, 4),
    status: 'active'
  }));
});

after(async () => {
  await db.destroy();
  await rm(sandbox, { recursive: true, force: true });
});

test('active admin can log in and receives a session', async () => {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: adminEmail, password: adminPassword });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.user.role, 'admin');
  assert.ok(response.body.accessToken);
  assert.ok(response.headers['set-cookie']?.some((cookie) => cookie.startsWith('clinico_refresh=')));
});

test('a new patient can register and receives a session', async () => {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({
      firstName: 'New',
      lastName: 'Patient',
      email: 'new-patient-auth-test@example.invalid',
      phone: '01012345678',
      dob: '1991-10-11',
      sex: 'female',
      password: 'new-patient-test-password-2026',
      consent: true
    });

  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.user.role, 'patient');
  assert.ok(response.body.accessToken);
  const patient = await db('patients').where({ user_id: response.body.user.id }).first();
  assert.ok(patient);
  assert.equal(patient.first_name, 'New');
});
