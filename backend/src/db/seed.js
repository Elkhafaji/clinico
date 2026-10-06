import bcrypt from 'bcryptjs';
import dayjs from 'dayjs';
import { db } from './knex.js';
import { insertAndGetId } from './insert-id.js';
import { env } from '../config/env.js';

const defaultSettings = {
  general: { clinicName: 'Clinico Systems', language: 'ar', theme: 'light', timezone: 'Africa/Cairo', currency: 'EGP' },
  booking: { publicBooking: true, maxAdvanceDays: 30, minAdvanceHours: 2, allowPatientCancel: true, autoConfirm: true },
  billing: { currency: 'EGP', taxPercent: 0, invoiceFormat: 'INV-{YYYY}-{#####}', paymentMethods: ['cash','card','wallet'] },
  notifications: { inApp: true, email: false, sms: false, reminderHours: 24 },
  security: { minPasswordLength: 8, requireDigit: false, requireUpper: false, requireSpecial: false, idleMinutes: 30 },
  backup: { daily: false }
};

async function createUser(trx, values) {
  const found = await trx('users').where({ email: values.email }).first();
  if (found) return found.id;
  return insertAndGetId(trx('users').insert(values));
}

async function addPatient(trx, clinicId, data, userId = null) {
  const fileNo = `CLN-${dayjs().format('YYMMDD')}-${String(Math.floor(Math.random()*90000)+10000)}`;
  const id = await insertAndGetId(trx('patients').insert({ clinic_id: clinicId, user_id: userId, file_no: fileNo, first_name: data.first_name, last_name: data.last_name, dob: data.dob || null, sex: data.sex || 'unspecified', phone: data.phone || null, email: data.email || null, status: 'active' }));
  await trx('patient_medical').insert({ patient_id: id, allergies: data.allergies || '', chronic_conditions: data.chronic_conditions || '', current_medications: data.current_medications || '', allergy_flag: Boolean(data.allergies) });
  return id;
}

async function seed() {
  const placeholderPassword = /^(replace|change|your)[-_ ]/i.test(String(env.adminPassword || ''));
  if (!env.adminEmail || !env.adminPassword || env.adminEmail.toLowerCase().endsWith('@example.com') || placeholderPassword) {
    throw new Error('Set a real ADMIN_EMAIL and ADMIN_PASSWORD in the ignored .env file; do not use the sample placeholders.');
  }
  if (env.adminPassword.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
  let adminCreated = false;
  await db.transaction(async (trx) => {
    let clinic = await trx('clinics').first();
    if (!clinic) {
      const id = await insertAndGetId(trx('clinics').insert({ name: 'Clinico Systems', phone: '', email: env.adminEmail, timezone: 'Africa/Cairo', currency: 'EGP', tax_percent: 0 }));
      clinic = await trx('clinics').where({ id }).first();
    }
    const currentAdmin = await trx('users').where({ email: env.adminEmail }).first();
    if (currentAdmin && currentAdmin.role !== 'admin') throw new Error('ADMIN_EMAIL is already assigned to a non-admin account. Choose a separate address for the system administrator.');
    if (!currentAdmin) {
      const passHash = await bcrypt.hash(env.adminPassword, 12);
      await trx('users').insert({ clinic_id: clinic.id, role: 'admin', full_name: env.adminName, email: env.adminEmail, password_hash: passHash, status: 'active', must_change_password: env.adminForcePasswordChange });
      adminCreated = true;
    }
    for (const [group, value] of Object.entries(defaultSettings)) {
      const key = `settings:${group}`;
      const existing = await trx('settings').where({ key }).first();
      if (!existing) await trx('settings').insert({ key, value: JSON.stringify(value) });
    }
    const perms = {
      doctor: ['patients.read','patients.write','appointments.read','appointments.write','queue.read','queue.manage','visits.read','visits.write','prescriptions.read','prescriptions.write','labs.read','labs.write','catalogs.read','messages.read','messages.write','reports.clinical','settings.profile'],
      receptionist: ['patients.read','patients.write','appointments.read','appointments.write','queue.read','queue.manage','labs.read','labs.collect','prescriptions.read','invoices.read','invoices.write','payments.write','catalogs.read','messages.read','messages.write','settings.profile'],
      patient: ['patient.self','patients.read','patients.write','appointments.read','appointments.write','queue.read','prescriptions.read','labs.read','invoices.read','messages.read','messages.write','settings.profile']
    };
    for (const [role, keys] of Object.entries(perms)) for (const permission_key of keys) {
      const exists = await trx('role_permissions').where({ role, permission_key }).first();
      if (!exists) await trx('role_permissions').insert({ role, permission_key, allowed: true });
    }
    if (!env.seedDemo) return;
    if (!env.demoPassword || env.demoPassword.length < 8) throw new Error('SEED_DEMO=true requires DEMO_PASSWORD (8+ characters).');
    const demoHash = await bcrypt.hash(env.demoPassword, 12);
    const doctorId = await createUser(trx, { clinic_id: clinic.id, role: 'doctor', full_name: 'د. نورهان سامي', email: 'doctor@clinico.local', phone: '01000000001', password_hash: demoHash, status: 'active', must_change_password: false });
    const recId = await createUser(trx, { clinic_id: clinic.id, role: 'receptionist', full_name: 'مريم حسن', email: 'reception@clinico.local', phone: '01000000002', password_hash: demoHash, status: 'active', must_change_password: false });
    const patientUserId = await createUser(trx, { clinic_id: clinic.id, role: 'patient', full_name: 'ياسمين علي', email: 'patient@clinico.local', phone: '01000000003', password_hash: demoHash, status: 'active', must_change_password: false });
    if (!(await trx('doctor_profiles').where({ user_id: doctorId }).first())) await trx('doctor_profiles').insert({ user_id: doctorId, clinic_id: clinic.id, specialty: 'طب الأسرة', avg_visit_minutes: 15 });
    for (let day = 0; day < 7; day++) {
      const existing = await trx('working_hours').where({ doctor_id: doctorId, weekday: day }).first();
      if (!existing) await trx('working_hours').insert({ doctor_id: doctorId, weekday: day, is_open: day !== 6, start_time: '09:00', end_time: '17:00' });
    }
    const serviceNames = [['كشف أولي', 500, 30, '#0f7778'], ['متابعة', 300, 20, '#0f5257'], ['استشارة', 400, 30, '#58c9c5'], ['تحليل', 250, 15, '#43a6a6']];
    for (const [name, price, duration, color] of serviceNames) if (!(await trx('services').where({ name }).first())) await trx('services').insert({ clinic_id: clinic.id, name, price, duration_minutes: duration, color });
    const tests = [
      ['صورة دم كاملة (CBC)','Complete blood count','دم','g/dL',12,17,180],
      ['سكر الدم التراكمي (HbA1c)','HbA1c','كيمياء','%',4,5.7,250],
      ['وظائف الكبد (ALT)','ALT','كيمياء','U/L',7,55,150],
      ['الكوليسترول الكلي','Total cholesterol','كيمياء','mg/dL',0,200,180]
    ];
    for (const [name_ar,name_en,category,unit,ref_min,ref_max,price] of tests) if (!(await trx('lab_tests').where({ name_ar }).first())) await trx('lab_tests').insert({ name_ar,name_en,category,unit,ref_min,ref_max,price,turnaround_hours:24 });
    for (const [name_ar,name_en,brand,medClass] of [['باراسيتامول','Paracetamol','بانادول','مسكن'],['أموكسيسيلين','Amoxicillin','أموكسيل','مضاد حيوي'],['إيبوبروفين','Ibuprofen','بروفين','مضاد التهاب']]) if (!(await trx('medications').where({ name_ar, brand }).first())) await trx('medications').insert({ name_ar,name_en,brand,class:medClass,common_doses:JSON.stringify(['500 mg','1 g']) });
    let patientCount = await trx('patients').count({ count: '*' }).first();
    let demoPatientId;
    if (Number(patientCount.count) === 0) {
      demoPatientId = await addPatient(trx, clinic.id, { first_name: 'ياسمين', last_name: 'علي', dob: '1992-03-14', sex: 'female', phone: '01000000003', email: 'patient@clinico.local', allergies: 'البنسلين' }, patientUserId);
      await addPatient(trx, clinic.id, { first_name: 'كريم', last_name: 'حسن', dob: '1988-08-21', sex: 'male', phone: '01000000004', allergies: '' });
      await addPatient(trx, clinic.id, { first_name: 'منى', last_name: 'سعيد', dob: '1979-01-06', sex: 'female', phone: '01000000005', chronic_conditions: 'ارتفاع ضغط الدم' });
      await addPatient(trx, clinic.id, { first_name: 'محمود', last_name: 'فؤاد', dob: '1968-11-10', sex: 'male', phone: '01000000006' });
      const tomorrow = dayjs().add(1,'day').hour(10).minute(0).second(0).millisecond(0);
      await trx('appointments').insert({ patient_id: demoPatientId, doctor_id: doctorId, service_id: (await trx('services').first()).id, type: 'first', start_at: tomorrow.toISOString(), end_at: tomorrow.add(30,'minute').toISOString(), status: 'confirmed', reason: 'كشف دوري', created_by: recId });
      await trx('notifications').insert({ user_id: patientUserId, type:'appointment', title:'تم تأكيد موعدك', body:'موعدك القادم غدًا الساعة 10:00 صباحًا.', link:'/portal/appointments', channel_status:JSON.stringify({inApp:'sent'}) });
    } else {
      const userPatient = await trx('patients').where({ user_id: patientUserId }).first();
      demoPatientId = userPatient?.id;
    }
    console.log(`Development sample accounts activated: doctor=${doctorId}, receptionist=${recId}, patient=${patientUserId}`);
  });
  console.log(adminCreated
    ? `Administrator provisioned for ${env.adminEmail}; forced password change: ${env.adminForcePasswordChange}.`
    : `Administrator ${env.adminEmail} already exists; existing credentials and account state were preserved.`);
}

try { await seed(); }
catch (error) { console.error('Seed failed:', error.message); process.exitCode = 1; }
finally { await db.destroy(); }
