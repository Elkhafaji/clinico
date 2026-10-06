import { Router } from 'express';
import dayjs from 'dayjs';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { insertAndGetId } from '../db/insert-id.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { asyncHandler, HttpError, idParam } from '../utils/http.js';
import { audit, notify } from '../utils/audit.js';

const router=Router();router.use(requireAuth);
const today=()=>dayjs().format('YYYY-MM-DD');
const joinedQueue=()=>db('queue_entries as q').join('patients as p','q.patient_id','p.id').join('users as d','q.doctor_id','d.id').leftJoin('appointments as a','q.appointment_id','a.id').select('q.*','p.first_name','p.last_name','p.file_no','p.phone','d.full_name as doctor_name','a.type as appointment_type');

router.get('/',requirePermission('queue.read'),asyncHandler(async(req,res)=>{
  const date=String(req.query.date||today());let doctorId=req.query.doctorId?Number(req.query.doctorId):null;if(req.user.role==='doctor')doctorId=req.user.id;
  let query=joinedQueue().where('q.queue_date',date).whereNot('q.status','removed');if(doctorId)query=query.where('q.doctor_id',doctorId);if(req.query.status)query=query.where('q.status',String(req.query.status));
  const rows=await query.orderBy('q.number','asc');
  const result=rows.map(x=>({id:x.id,number:x.number,patientId:x.patient_id,patientName:`${x.first_name} ${x.last_name}`,fileNo:x.file_no,phone:x.phone,doctorId:x.doctor_id,doctorName:x.doctor_name,appointmentId:x.appointment_id,appointmentType:x.appointment_type,status:x.status,arrivedAt:x.arrived_at,calledAt:x.called_at,queueDate:x.queue_date}));
  res.json({data:result,current:result.find(x=>['called','in_visit'].includes(x.status))||null,waiting:result.filter(x=>x.status==='waiting').length});
}));

router.post('/',requirePermission('queue.manage'),asyncHandler(async(req,res)=>{
  const input=z.object({patientId:z.coerce.number().int().positive(),doctorId:z.coerce.number().int().positive(),appointmentId:z.coerce.number().int().positive().nullable().optional()}).parse(req.body);
  const patient=await db('patients').where({id:input.patientId}).whereNull('deleted_at').first();const doctor=await db('users').where({id:input.doctorId,role:'doctor',status:'active'}).first();if(!patient)throw new HttpError(404,'PATIENT_NOT_FOUND','المريض غير موجود.');if(!doctor)throw new HttpError(404,'DOCTOR_NOT_FOUND','الطبيب غير متاح.');
  const date=today();const entry=await db.transaction(async trx=>{const latest=await trx('queue_entries').where({doctor_id:input.doctorId,queue_date:date}).max({max:'number'}).first();const number=Number(latest?.max||0)+1;const id=await insertAndGetId(trx('queue_entries').insert({queue_date:date,number,patient_id:input.patientId,doctor_id:input.doctorId,appointment_id:input.appointmentId||null,status:'waiting'}));return trx('queue_entries').where({id}).first();});
  await audit(req,'queue.add','queue_entry',entry.id,{number:entry.number,patientId:input.patientId});if(patient.user_id)await notify(patient.user_id,'queue','تمت إضافتك إلى الطابور',`رقمك ${entry.number}.`,'/portal/queue');res.status(201).json({data:entry});
}));

router.get('/me',requirePermission('queue.read'),asyncHandler(async(req,res)=>{
  if(req.user.role!=='patient')throw new HttpError(403,'FORBIDDEN','هذه الشاشة مخصصة للمريض.');
  const patient=await db('patients').where({user_id:req.user.id}).first();if(!patient)throw new HttpError(404,'PATIENT_NOT_FOUND','ملف المريض غير موجود.');
  const entry=await db('queue_entries').where({patient_id:patient.id,queue_date:today()}).whereNotIn('status',['done','skipped','removed']).orderBy('number','desc').first();
  if(!entry)return res.json({data:null,patientsAhead:0,estimatedWaitMinutes:0});
  const [ahead,profile]=await Promise.all([db('queue_entries').where({doctor_id:entry.doctor_id,queue_date:entry.queue_date,status:'waiting'}).where('number','<',entry.number).count({count:'*'}).first(),db('doctor_profiles').where({user_id:entry.doctor_id}).first()]);
  const count=Number(ahead.count||0);res.json({data:entry,patientsAhead:count,estimatedWaitMinutes:count*Number(profile?.avg_visit_minutes||15)});
}));

router.post('/:id/call',requirePermission('queue.manage'),asyncHandler(async(req,res)=>{
  const id=idParam(req.params.id);const entry=await db('queue_entries').where({id}).first();if(!entry)throw new HttpError(404,'QUEUE_NOT_FOUND','الرقم غير موجود.');if(req.user.role==='doctor'&&Number(entry.doctor_id)!==Number(req.user.id))throw new HttpError(403,'FORBIDDEN','لا يمكنك إدارة طابور طبيب آخر.');
  await db.transaction(async trx=>{await trx('queue_entries').where({id}).update({status:'called',called_at:trx.fn.now(),updated_at:trx.fn.now()});if(entry.appointment_id)await trx('appointments').where({id:entry.appointment_id}).update({status:'in_progress',updated_at:trx.fn.now()});});
  const patient=await db('patients').where({id:entry.patient_id}).first();if(patient?.user_id)await notify(patient.user_id,'queue','حان دورك','يرجى التوجه إلى غرفة الطبيب.','/portal/queue');await audit(req,'queue.call','queue_entry',id,{number:entry.number});res.json({message:'تم نداء المريض.'});
}));
router.post('/:id/skip',requirePermission('queue.manage'),asyncHandler(async(req,res)=>{const id=idParam(req.params.id);const entry=await db('queue_entries').where({id}).first();if(!entry)throw new HttpError(404,'QUEUE_NOT_FOUND','الرقم غير موجود.');if(req.user.role==='doctor'&&Number(entry.doctor_id)!==Number(req.user.id))throw new HttpError(403,'FORBIDDEN','لا يمكنك إدارة طابور طبيب آخر.');await db('queue_entries').where({id}).update({status:'skipped',updated_at:db.fn.now()});await audit(req,'queue.skip','queue_entry',id);res.json({message:'تم تخطي المريض.'});}));
router.post('/:id/remove',requirePermission('queue.manage'),asyncHandler(async(req,res)=>{const id=idParam(req.params.id);const entry=await db('queue_entries').where({id}).first();if(!entry)throw new HttpError(404,'QUEUE_NOT_FOUND','الرقم غير موجود.');if(req.user.role==='doctor'&&Number(entry.doctor_id)!==Number(req.user.id))throw new HttpError(403,'FORBIDDEN','لا يمكنك إدارة طابور طبيب آخر.');await db('queue_entries').where({id}).update({status:'removed',updated_at:db.fn.now()});await audit(req,'queue.remove','queue_entry',id);res.json({message:'تم حذف المريض من قائمة الانتظار.'});}));
router.post('/:id/finish',requirePermission('queue.manage'),asyncHandler(async(req,res)=>{
  const id=idParam(req.params.id);const entry=await db('queue_entries').where({id}).first();if(!entry)throw new HttpError(404,'QUEUE_NOT_FOUND','الرقم غير موجود.');if(req.user.role==='doctor'&&Number(entry.doctor_id)!==Number(req.user.id))throw new HttpError(403,'FORBIDDEN','لا يمكنك إدارة طابور طبيب آخر.');
  const next=await db.transaction(async trx=>{await trx('queue_entries').where({id}).update({status:'done',finished_at:trx.fn.now(),updated_at:trx.fn.now()});if(entry.appointment_id)await trx('appointments').where({id:entry.appointment_id}).update({status:'completed',updated_at:trx.fn.now()});const nextEntry=await trx('queue_entries').where({doctor_id:entry.doctor_id,queue_date:entry.queue_date,status:'waiting'}).orderBy('number','asc').first();if(nextEntry){await trx('queue_entries').where({id:nextEntry.id}).update({status:'called',called_at:trx.fn.now(),updated_at:trx.fn.now()});if(nextEntry.appointment_id)await trx('appointments').where({id:nextEntry.appointment_id}).update({status:'in_progress',updated_at:trx.fn.now()});}return nextEntry;});
  if(next){const p=await db('patients').where({id:next.patient_id}).first();if(p?.user_id)await notify(p.user_id,'queue','حان دورك','يرجى التوجه إلى غرفة الطبيب.','/portal/queue');}
  await audit(req,'queue.finish','queue_entry',id,{nextQueueId:next?.id||null});res.json({message:'انتهى الكشف.',next:next||null});
}));

export default router;
