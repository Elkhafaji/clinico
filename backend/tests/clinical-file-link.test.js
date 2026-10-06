import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

const sandbox = await mkdtemp(path.join(os.tmpdir(), 'clinico-api-test-'));
process.env.NODE_ENV = 'test';
process.env.DB_CLIENT = 'better-sqlite3';
process.env.DB_FILENAME = path.join(sandbox, 'test.sqlite');
process.env.UPLOAD_DIR = path.join(sandbox, 'uploads');
process.env.BACKUP_DIR = path.join(sandbox, 'backups');
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'clinical-file-test-access-secret-32-chars';
process.env.JWT_REFRESH_SECRET = 'clinical-file-test-refresh-secret-32-chars';

const { db } = await import('../src/db/knex.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/middleware/auth.js');

let token;
let patientId;
let otherPatientId;
let labOrderId;
let labItemId;
let qualitativeItemId;
let adminId;

function firstId(value) {
  return Array.isArray(value) ? value[0] : value;
}

before(async () => {
  await db.migrate.latest();
  const clinicId = firstId(await db('clinics').insert({ name: 'Test clinic', timezone: 'Africa/Cairo', currency: 'EGP' }));
  adminId = firstId(await db('users').insert({
    clinic_id: clinicId,
    role: 'admin',
    full_name: 'Test Admin',
    email: 'admin@test.invalid',
    password_hash: 'not-used-in-this-test',
    status: 'active'
  }));
  const admin = await db('users').where({ id: adminId }).first();
  token = signAccessToken(admin);

  patientId = firstId(await db('patients').insert({ clinic_id: clinicId, file_no: 'TEST-001', first_name: 'Test', last_name: 'Patient' }));
  otherPatientId = firstId(await db('patients').insert({ clinic_id: clinicId, file_no: 'TEST-002', first_name: 'Other', last_name: 'Patient' }));
  const testId = firstId(await db('lab_tests').insert({ name_ar: 'اختبار تكاملي', name_en: 'Integration test' }));
  labOrderId = firstId(await db('lab_orders').insert({ patient_id: patientId, doctor_id: adminId, status: 'sample_collected' }));
  labItemId = firstId(await db('lab_order_items').insert({ lab_order_id: labOrderId, lab_test_id: testId, price_snapshot: 0 }));
  qualitativeItemId = firstId(await db('lab_order_items').insert({ lab_order_id: labOrderId, lab_test_id: testId, price_snapshot: 0 }));
});

after(async () => {
  await db.destroy();
  await rm(sandbox, { recursive: true, force: true });
});

test('health endpoint reports the migrated database as connected', async () => {
  const response = await request(app).get('/api/v1/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.database, 'connected');
});

test('uploaded lab result file is stored against the supplied patient', async () => {
  const response = await request(app)
    .post('/api/v1/files')
    .set('Authorization', `Bearer ${token}`)
    .field('kind', 'lab-result')
    .field('patientId', String(patientId))
    .attach('file', Buffer.from('%PDF-1.4\nClinico test file'), { filename: 'result.pdf', contentType: 'application/pdf' });

  assert.equal(response.status, 201, JSON.stringify(response.body));
  const file = await db('files').where({ id: response.body.data.id }).first();
  assert.equal(Number(file.patient_id), Number(patientId));
  assert.equal(file.kind, 'lab-result');
});

test('lab result accepts and persists an attachment belonging to the same patient', async () => {
  const uploaded = await request(app)
    .post('/api/v1/files')
    .set('Authorization', `Bearer ${token}`)
    .field('kind', 'lab-result')
    .field('patientId', String(patientId))
    .attach('file', Buffer.from('%PDF-1.4\nResult for patient one'), { filename: 'patient-one.pdf', contentType: 'application/pdf' });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));

  const response = await request(app)
    .post(`/api/v1/lab-orders/${labOrderId}/items/${labItemId}/result`)
    .set('Authorization', `Bearer ${token}`)
    .send({ valueNumber: 5.2, fileId: uploaded.body.data.id });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  const item = await db('lab_order_items').where({ id: labItemId }).first();
  assert.equal(Number(item.file_id), Number(uploaded.body.data.id));
  assert.equal(Number(item.value_number), 5.2);
});

test('text-only result keeps the numeric value null instead of coercing it to zero', async () => {
  const response = await request(app)
    .post(`/api/v1/lab-orders/${labOrderId}/items/${qualitativeItemId}/result`)
    .set('Authorization', `Bearer ${token}`)
    .send({ valueText: 'سلبي', valueNumber: null });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  const item = await db('lab_order_items').where({ id: qualitativeItemId }).first();
  assert.equal(item.value_text, 'سلبي');
  assert.equal(item.value_number, null);
  assert.equal(item.flag, 'unknown');
});

test('lab result rejects an attachment tied to a different patient', async () => {
  const otherFileId = firstId(await db('files').insert({
    owner_id: adminId,
    patient_id: otherPatientId,
    path: path.join(sandbox, 'not-served.pdf'),
    original_name: 'other-patient.pdf',
    mime: 'application/pdf',
    size: 10,
    kind: 'lab-result',
    uploaded_by: adminId
  }));

  const response = await request(app)
    .post(`/api/v1/lab-orders/${labOrderId}/items/${labItemId}/result`)
    .set('Authorization', `Bearer ${token}`)
    .send({ valueText: 'should not be saved', fileId: otherFileId });

  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'FILE_MISMATCH');
});
