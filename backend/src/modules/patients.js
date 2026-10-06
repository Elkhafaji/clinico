import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { insertAndGetId } from '../db/insert-id.js';
import { requireAuth, requirePermission, ensurePatientAccess } from '../middleware/auth.js';
import { asyncHandler, HttpError, idParam, pagination, pageResult } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const router = Router();
router.use(requireAuth);
const patientInput = z.object({
  firstName: z.string().trim().min(2).max(100), lastName: z.string().trim().min(2).max(100),
  dob: z.string().optional().nullable(), sex: z.enum(['female','male','unspecified']).default('unspecified'),
  phone: z.string().trim().max(32).optional().nullable(), email: z.union([z.string().email(), z.literal('')]).optional().nullable(),
  address: z.string().max(500).optional().nullable(), emergencyContactName: z.string().max(160).optional().nullable(), emergencyContactPhone: z.string().max(32).optional().nullable(),
  allergies: z.string().max(4000).optional().nullable(), chronicConditions: z.string().max(4000).optional().nullable(), currentMedications: z.string().max(4000).optional().nullable(), initialNotes: z.string().max(4000).optional().nullable()
});
const shapePatient = (row, med = null) => ({ id: row.id, fileNo: row.file_no, firstName: row.first_name, lastName: row.last_name, fullName: `${row.first_name} ${row.last_name}`, dob: row.dob, sex: row.sex, phone: row.phone, email: row.email, address: row.address, emergencyContactName: row.emergency_contact_name, emergencyContactPhone: row.emergency_contact_phone, status: row.status, userId: row.user_id, createdAt: row.created_at, medical: med ? { allergies: med.allergies || '', chronicConditions: med.chronic_conditions || '', currentMedications: med.current_medications || '', initialNotes: med.initial_notes || '', allergyFlag: Boolean(med.allergy_flag) } : undefined });
const makeFileNo = () => `CLN-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

router.get('/', requirePermission('patients.read'), asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pagination(req.query);
  const q = String(req.query.q || '').trim();
  let query = db('patients').whereNull('deleted_at');
  if (req.user.role === 'patient') query = query.where({ user_id: req.user.id });
  if (q) query = query.andWhere((builder) => builder.where('first_name','like',`%${q}%`).orWhere('last_name','like',`%${q}%`).orWhere('file_no','like',`%${q}%`).orWhere('phone','like',`%${q}%`));
  const totalRow = await query.clone().count({ count: '*' }).first();
  const rows = await query.clone().orderBy('created_at','desc').limit(pageSize).offset(offset);
  const ids = rows.map((row) => row.id);
  const medicalRows = ids.length ? await db('patient_medical').whereIn('patient_id', ids) : [];
  const medicalById = new Map(medicalRows.map((row) => [row.patient_id, row]));
  if (req.user.role !== 'patient') await audit(req, 'patient.list.read', 'patient', null, { count: rows.length });
  res.json(pageResult(rows.map((row) => shapePatient(row, medicalById.get(row.id))), Number(totalRow.count), page, pageSize));
}));

router.post('/', requirePermission('patients.write'), asyncHandler(async (req, res) => {
  const input = patientInput.parse(req.body);
  const fileNo = makeFileNo();
  const patientId = await db.transaction(async (trx) => {
    const id = await insertAndGetId(trx('patients').insert({ clinic_id: req.user.clinic_id, file_no: fileNo, first_name: input.firstName, last_name: input.lastName, dob: input.dob || null, sex: input.sex, phone: input.phone || null, email: input.email || null, address: input.address || null, emergency_contact_name: input.emergencyContactName || null, emergency_contact_phone: input.emergencyContactPhone || null, status: 'active' }));
    await trx('patient_medical').insert({ patient_id: id, allergies: input.allergies || '', chronic_conditions: input.chronicConditions || '', current_medications: input.currentMedications || '', initial_notes: input.initialNotes || '', allergy_flag: Boolean(input.allergies?.trim()) });
    await trx('audit_logs').insert({ user_id: req.user.id, action: 'patient.create', entity: 'patient', entity_id: String(id), ip: req.ip });
    return id;
  });
  const row = await db('patients').where({ id: patientId }).first();
  const med = await db('patient_medical').where({ patient_id: patientId }).first();
  res.status(201).json({ data: shapePatient(row, med) });
}));

router.get('/:id', requirePermission('patients.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const row = await db('patients').where({ id }).whereNull('deleted_at').first();
  if (!row) throw new HttpError(404,'PATIENT_NOT_FOUND','ملف المريض غير موجود.');
  ensurePatientAccess(row, req.user);
  const med = await db('patient_medical').where({ patient_id: id }).first();
  await audit(req, 'patient.read', 'patient', id);
  res.json({ data: shapePatient(row, med) });
}));

router.patch('/:id', requirePermission('patients.write'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const row = await db('patients').where({ id }).whereNull('deleted_at').first();
  if (!row) throw new HttpError(404,'PATIENT_NOT_FOUND','ملف المريض غير موجود.');
  ensurePatientAccess(row, req.user);
  if (req.user.role === 'patient' && Number(row.user_id) !== Number(req.user.id)) throw new HttpError(403,'FORBIDDEN','لا يمكنك تعديل هذا الملف.');
  const partial = patientInput.partial().parse(req.body);
  const columns = { firstName:'first_name',lastName:'last_name',dob:'dob',sex:'sex',phone:'phone',email:'email',address:'address',emergencyContactName:'emergency_contact_name',emergencyContactPhone:'emergency_contact_phone' };
  const update = {};
  for (const [key,column] of Object.entries(columns)) if (Object.hasOwn(partial,key)) update[column] = partial[key] || null;
  if (Object.keys(update).length) { update.updated_at = db.fn.now(); await db('patients').where({ id }).update(update); }
  const medical = {};
  if (Object.hasOwn(partial,'allergies')) { medical.allergies = partial.allergies || ''; medical.allergy_flag = Boolean(partial.allergies?.trim()); }
  if (Object.hasOwn(partial,'chronicConditions')) medical.chronic_conditions = partial.chronicConditions || '';
  if (Object.hasOwn(partial,'currentMedications')) medical.current_medications = partial.currentMedications || '';
  if (Object.hasOwn(partial,'initialNotes')) medical.initial_notes = partial.initialNotes || '';
  if (Object.keys(medical).length) { medical.updated_at = db.fn.now(); await db('patient_medical').where({ patient_id:id }).update(medical); }
  await audit(req,'patient.update','patient',id,{ fields:Object.keys(partial) });
  const fresh = await db('patients').where({ id }).first(); const med = await db('patient_medical').where({ patient_id:id }).first();
  res.json({ data: shapePatient(fresh,med) });
}));

router.delete('/:id', requirePermission('patients.write'), asyncHandler(async (req, res) => {
  if (!['admin','receptionist'].includes(req.user.role)) throw new HttpError(403,'FORBIDDEN','الحذف المؤقت متاح لمسؤول العيادة والاستقبال فقط.');
  const id = idParam(req.params.id);
  const row = await db('patients').where({ id }).whereNull('deleted_at').first();
  if (!row) throw new HttpError(404,'PATIENT_NOT_FOUND','ملف المريض غير موجود.');
  await db('patients').where({ id }).update({ deleted_at: db.fn.now(), status: 'archived', updated_at: db.fn.now() });
  await audit(req,'patient.archive','patient',id);
  res.json({ message:'تم أرشفة ملف المريض. السجل الطبي محفوظ.' });
}));

router.get('/:id/medical', requirePermission('patients.read'), asyncHandler(async (req,res) => {
  const id=idParam(req.params.id); const patient=await db('patients').where({id}).whereNull('deleted_at').first();
  if(!patient) throw new HttpError(404,'PATIENT_NOT_FOUND','ملف المريض غير موجود.'); ensurePatientAccess(patient,req.user);
  const medical=await db('patient_medical').where({patient_id:id}).first(); await audit(req,'patient.medical.read','patient',id);
  res.json({ data: { allergies:medical?.allergies||'', chronicConditions:medical?.chronic_conditions||'', currentMedications:medical?.current_medications||'', initialNotes:medical?.initial_notes||'', allergyFlag:Boolean(medical?.allergy_flag) } });
}));
router.patch('/:id/medical', requirePermission('patients.write'), asyncHandler(async (req,res) => {
  const id=idParam(req.params.id); const patient=await db('patients').where({id}).whereNull('deleted_at').first(); if(!patient) throw new HttpError(404,'PATIENT_NOT_FOUND','ملف المريض غير موجود.'); ensurePatientAccess(patient,req.user);
  const input=z.object({allergies:z.string().max(4000).optional(),chronicConditions:z.string().max(4000).optional(),currentMedications:z.string().max(4000).optional(),initialNotes:z.string().max(4000).optional()}).parse(req.body);
  const update={updated_at:db.fn.now()}; if(input.allergies!==undefined){update.allergies=input.allergies;update.allergy_flag=Boolean(input.allergies.trim());} if(input.chronicConditions!==undefined)update.chronic_conditions=input.chronicConditions; if(input.currentMedications!==undefined)update.current_medications=input.currentMedications; if(input.initialNotes!==undefined)update.initial_notes=input.initialNotes;
  await db('patient_medical').where({patient_id:id}).update(update); await audit(req,'patient.medical.update','patient',id,{fields:Object.keys(input)}); res.json({message:'تم حفظ البيانات الطبية.'});
}));
router.get('/:id/timeline', requirePermission('patients.read'), asyncHandler(async (req,res) => {
  const id=idParam(req.params.id);const patient=await db('patients').where({id}).whereNull('deleted_at').first();if(!patient)throw new HttpError(404,'PATIENT_NOT_FOUND','ملف المريض غير موجود.');ensurePatientAccess(patient,req.user);
  const [visits, appointments, labs, prescriptions, notes] = await Promise.all([
    db('visits').where({patient_id:id}).orderBy('created_at','desc').limit(40),
    db('appointments').where({patient_id:id}).orderBy('start_at','desc').limit(40),
    db('lab_orders').where({patient_id:id}).orderBy('ordered_at','desc').limit(40),
    db('prescriptions').where({patient_id:id}).orderBy('issued_at','desc').limit(40),
    db('notes').where({patient_id:id}).orderBy('created_at','desc').limit(40)
  ]);
  const data=[...visits.map(x=>({...x,kind:'visit'})),...appointments.map(x=>({...x,kind:'appointment'})),...labs.map(x=>({...x,kind:'lab'})),...prescriptions.map(x=>({...x,kind:'prescription'})),...notes.map(x=>({...x,kind:'note'}))].sort((a,b)=>new Date(b.created_at||b.start_at||b.ordered_at||b.issued_at)-new Date(a.created_at||a.start_at||a.ordered_at||a.issued_at));
  await audit(req,'patient.timeline.read','patient',id);res.json({data});
}));

export default router;
