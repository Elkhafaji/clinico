import { Router } from 'express';
import dayjs from 'dayjs';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { insertAndGetId } from '../db/insert-id.js';
import { requireAuth, requirePermission, ensurePatientAccess } from '../middleware/auth.js';
import { asyncHandler, HttpError, idParam, pagination, pageResult } from '../utils/http.js';
import { audit, notify } from '../utils/audit.js';

const router = Router(); router.use(requireAuth);
const toIso = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const appointmentInput = z.object({ patientId:z.coerce.number().int().positive().optional(), doctorId:z.coerce.number().int().positive(), serviceId:z.coerce.number().int().positive().optional().nullable(), type:z.enum(['first','follow_up','consultation','lab']).default('first'), startAt:z.string().min(10), endAt:z.string().min(10), reason:z.string().max(500).optional().nullable(), notes:z.string().max(4000).optional().nullable() });

async function getBookingSettings() { const row=await db('settings').where({key:'settings:booking'}).first(); return row?JSON.parse(row.value):{minAdvanceHours:2,maxAdvanceDays:30,allowPatientCancel:true,autoConfirm:true}; }
async function checkSlot(trx, doctorId, startAt, endAt, exceptId = null) {
  let q=trx('appointments').where({doctor_id:doctorId}).whereNot('status','cancelled').where('start_at','<',endAt).where('end_at','>',startAt);
  if(exceptId) q=q.whereNot('id',exceptId);
  const conflict=await q.first();
  if(conflict) throw new HttpError(409,'BOOKING_CONFLICT',`هذا الموعد يتعارض مع موعد آخر في الساعة ${dayjs(conflict.start_at).format('HH:mm')}.`);
}
async function checkHorizon(startAt) {
  const settings=await getBookingSettings(); const now=Date.now(); const time=new Date(startAt).getTime();
  if(time < now + Number(settings.minAdvanceHours||0)*3600000) throw new HttpError(422,'ADVANCE_TOO_SHORT',`يجب الحجز قبل الموعد بـ ${settings.minAdvanceHours||0} ساعة على الأقل.`);
  if(time > now + Number(settings.maxAdvanceDays||30)*86400000) throw new HttpError(422,'ADVANCE_TOO_LONG',`الحجز متاح حتى ${settings.maxAdvanceDays||30} يومًا مقدمًا.`);
}

router.get('/', requirePermission('appointments.read'), asyncHandler(async(req,res)=>{
  const {page,pageSize,offset}=pagination(req.query);const q=String(req.query.q||'').trim();const from=String(req.query.from||'').trim();const to=String(req.query.to||'').trim();
  let query=db('appointments as a').join('patients as p','a.patient_id','p.id').join('users as d','a.doctor_id','d.id').leftJoin('services as s','a.service_id','s.id').select('a.*','p.first_name','p.last_name','p.file_no','p.phone as patient_phone','d.full_name as doctor_name','s.name as service_name','s.price as service_price');
  if(req.user.role==='doctor')query=query.where('a.doctor_id',req.user.id);
  if(req.user.role==='patient'){const patient=await db('patients').where({user_id:req.user.id}).first();if(!patient)return res.json(pageResult([],0,page,pageSize));query=query.where('a.patient_id',patient.id);}
  if(from)query=query.where('a.start_at','>=',toIso(from)||from);if(to)query=query.where('a.start_at','<=',toIso(to)||to);
  if(q)query=query.andWhere((b)=>b.where('p.first_name','like',`%${q}%`).orWhere('p.last_name','like',`%${q}%`).orWhere('d.full_name','like',`%${q}%`));
  if(req.query.status)query=query.where('a.status',String(req.query.status));
  const totalQ=query.clone().clearSelect().clearOrder().count({count:'a.id'}).first();const [totalRow,rows]=await Promise.all([totalQ,query.clone().orderBy('a.start_at','asc').limit(pageSize).offset(offset)]);
  res.json(pageResult(rows.map(a=>({id:a.id,patientId:a.patient_id,patientName:`${a.first_name} ${a.last_name}`,fileNo:a.file_no,patientPhone:a.patient_phone,doctorId:a.doctor_id,doctorName:a.doctor_name,serviceId:a.service_id,serviceName:a.service_name,servicePrice:a.service_price,type:a.type,startAt:a.start_at,endAt:a.end_at,reason:a.reason,notes:a.notes,status:a.status,createdAt:a.created_at})),Number(totalRow.count),page,pageSize));
}));

router.post('/', requirePermission('appointments.write'), asyncHandler(async(req,res)=>{
  const input=appointmentInput.parse(req.body);const start=toIso(input.startAt);const end=toIso(input.endAt);if(!start||!end||new Date(end)<=new Date(start))throw new HttpError(422,'INVALID_SLOT','وقت نهاية الموعد يجب أن يأتي بعد وقت البداية.');
  let patientId=input.patientId;
  if(req.user.role==='patient'){const patient=await db('patients').where({user_id:req.user.id}).first();if(!patient)throw new HttpError(404,'PATIENT_NOT_FOUND','أنشئ ملفك الطبي أولًا.');patientId=patient.id;}
  if(!patientId)throw new HttpError(422,'PATIENT_REQUIRED','اختر المريض.');
  const patient=await db('patients').where({id:patientId}).whereNull('deleted_at').first();if(!patient)throw new HttpError(404,'PATIENT_NOT_FOUND','ملف المريض غير موجود.');
  const doctor=await db('users').where({id:input.doctorId,role:'doctor',status:'active'}).whereNull('deleted_at').first();if(!doctor)throw new HttpError(404,'DOCTOR_NOT_FOUND','الطبيب غير متاح.');
  if(req.user.role==='doctor'&&Number(doctor.id)!==Number(req.user.id))throw new HttpError(403,'FORBIDDEN','يمكن للطبيب الحجز في جدوله فقط.');
  await checkHorizon(start);
  const settings=await getBookingSettings();
  const id=await db.transaction(async(trx)=>{
    await checkSlot(trx,input.doctorId,start,end);
    return insertAndGetId(trx('appointments').insert({patient_id:patientId,doctor_id:input.doctorId,service_id:input.serviceId||null,type:input.type,start_at:start,end_at:end,reason:input.reason||null,notes:input.notes||null,status:settings.autoConfirm===false&&req.user.role==='patient'?'pending':'confirmed',created_by:req.user.id}));
  });
  await audit(req,'appointment.create','appointment',id,{patientId,doctorId:input.doctorId});
  if(patient.user_id)await notify(patient.user_id,'appointment','تم تسجيل موعد جديد',`موعدك ${dayjs(start).format('YYYY-MM-DD HH:mm')}.`,'/portal/appointments');
  const created=await db('appointments').where({id}).first();res.status(201).json({data:created});
}));

router.get('/:id', requirePermission('appointments.read'), asyncHandler(async(req,res)=>{const id=idParam(req.params.id);const row=await db('appointments').where({id}).first();if(!row)throw new HttpError(404,'APPOINTMENT_NOT_FOUND','الموعد غير موجود.');if(req.user.role==='patient'){const patient=await db('patients').where({id:row.patient_id}).first();ensurePatientAccess(patient,req.user);}if(req.user.role==='doctor'&&Number(row.doctor_id)!==Number(req.user.id))throw new HttpError(403,'FORBIDDEN','لا يمكنك فتح هذا الموعد.');res.json({data:row});}));

router.patch('/:id', requirePermission('appointments.write'), asyncHandler(async(req,res)=>{
  const id=idParam(req.params.id);const row=await db('appointments').where({id}).first();if(!row)throw new HttpError(404,'APPOINTMENT_NOT_FOUND','الموعد غير موجود.');
  if(req.user.role==='doctor'&&Number(row.doctor_id)!==Number(req.user.id))throw new HttpError(403,'FORBIDDEN','لا يمكنك تعديل هذا الموعد.');
  const input=z.object({startAt:z.string().optional(),endAt:z.string().optional(),doctorId:z.coerce.number().int().positive().optional(),serviceId:z.coerce.number().int().positive().nullable().optional(),type:z.enum(['first','follow_up','consultation','lab']).optional(),reason:z.string().max(500).nullable().optional(),notes:z.string().max(4000).nullable().optional(),status:z.enum(['pending','confirmed','checked_in','in_progress','completed','cancelled','no_show']).optional()}).parse(req.body);
  const start=input.startAt?toIso(input.startAt):row.start_at;const end=input.endAt?toIso(input.endAt):row.end_at;const doctorId=input.doctorId||row.doctor_id;if(!start||!end||new Date(end)<=new Date(start))throw new HttpError(422,'INVALID_SLOT','وقت نهاية الموعد يجب أن يأتي بعد وقت البداية.');
  if(input.startAt||input.endAt||input.doctorId){await checkHorizon(start);await db.transaction(async trx=>checkSlot(trx,doctorId,start,end,id));}
  const update={};if(input.startAt||input.endAt){update.start_at=start;update.end_at=end;}if(input.doctorId)update.doctor_id=doctorId;if(input.serviceId!==undefined)update.service_id=input.serviceId;if(input.type)update.type=input.type;if(input.reason!==undefined)update.reason=input.reason;if(input.notes!==undefined)update.notes=input.notes;if(input.status)update.status=input.status;update.updated_at=db.fn.now();
  await db('appointments').where({id}).update(update);await audit(req,'appointment.update','appointment',id,{fields:Object.keys(input)});res.json({data:await db('appointments').where({id}).first()});
}));

router.post('/:id/cancel', requirePermission('appointments.write'), asyncHandler(async(req,res)=>{
  const id=idParam(req.params.id);const row=await db('appointments').where({id}).first();if(!row)throw new HttpError(404,'APPOINTMENT_NOT_FOUND','الموعد غير موجود.');
  if(req.user.role==='doctor'&&Number(row.doctor_id)!==Number(req.user.id))throw new HttpError(403,'FORBIDDEN','لا يمكنك إلغاء هذا الموعد.');
  if(req.user.role==='patient'){const patient=await db('patients').where({id:row.patient_id}).first();ensurePatientAccess(patient,req.user);const settings=await getBookingSettings();if(!settings.allowPatientCancel)throw new HttpError(403,'CANCELLATION_DISABLED','إلغاء المواعيد غير متاح من حساب المريض.');if(new Date(row.start_at).getTime()-Date.now()<Number(settings.minAdvanceHours||0)*3600000)throw new HttpError(422,'CANCELLATION_TOO_LATE','لا يمكن إلغاء الموعد خلال الفترة المحددة قبل الحضور.');}
  await db('appointments').where({id}).update({status:'cancelled',cancelled_by:req.user.id,cancelled_at:db.fn.now(),updated_at:db.fn.now()});await audit(req,'appointment.cancel','appointment',id);res.json({message:'تم إلغاء الموعد.'});
}));

router.post('/:id/check-in', requirePermission('appointments.write'), asyncHandler(async(req,res)=>{
  const id=idParam(req.params.id);const appointment=await db('appointments').where({id}).first();if(!appointment)throw new HttpError(404,'APPOINTMENT_NOT_FOUND','الموعد غير موجود.');if(appointment.status==='cancelled')throw new HttpError(422,'APPOINTMENT_CANCELLED','لا يمكن تسجيل الوصول لموعد ملغى.');
  const queue=await db.transaction(async(trx)=>{
    const found=await trx('queue_entries').where({appointment_id:id}).first();if(found)return found;
    const today=dayjs().format('YYYY-MM-DD');const latest=await trx('queue_entries').where({doctor_id:appointment.doctor_id,queue_date:today}).max({max:'number'}).first();const number=Number(latest?.max||0)+1;
    await trx('appointments').where({id}).update({status:'checked_in',updated_at:trx.fn.now()});const queueId=await insertAndGetId(trx('queue_entries').insert({queue_date:today,number,patient_id:appointment.patient_id,appointment_id:id,doctor_id:appointment.doctor_id,status:'waiting'}));return trx('queue_entries').where({id:queueId}).first();
  });
  await audit(req,'appointment.checkin','appointment',id,{queueNumber:queue.number});res.status(201).json({data:queue});
}));

export default router;
