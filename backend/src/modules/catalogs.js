import { Router } from 'express';
import { localDayRange } from '../utils/time.js';
import { z } from 'zod';
import { db, clientName } from '../db/knex.js';
import { insertAndGetId } from '../db/insert-id.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { asyncHandler, HttpError, idParam, pagination, pageResult } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const router=Router();router.use(requireAuth);

router.get('/doctors',asyncHandler(async(req,res)=>{
  const rows=await db('users as u').leftJoin('doctor_profiles as p','u.id','p.user_id').where({role:'doctor',status:'active'}).whereNull('deleted_at').select('u.id','u.full_name','u.phone','u.email','u.avatar_path','p.specialty','p.bio','p.avg_visit_minutes').orderBy('u.full_name');
  res.json({data:rows.map(x=>({id:x.id,fullName:x.full_name,phone:x.phone,email:x.email,avatarPath:x.avatar_path,specialty:x.specialty||'طب الأسرة',bio:x.bio||'',avgVisitMinutes:x.avg_visit_minutes||15}))});
}));
router.get('/doctors/:id/availability',asyncHandler(async(req,res)=>{
  const doctorId=idParam(req.params.id);const date=String(req.query.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new HttpError(422,'INVALID_DATE','أدخل تاريخًا صحيحًا.');
  const doctor=await db('users').where({id:doctorId,role:'doctor',status:'active'}).whereNull('deleted_at').first();if(!doctor)throw new HttpError(404,'DOCTOR_NOT_FOUND','الطبيب غير موجود.');
  const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();const hours=await db('working_hours').where({doctor_id:doctorId,weekday}).first();
  if(!hours||!hours.is_open)return res.json({data:[],working:false});
  const [dayStart, dayEnd] = localDayRange(date);
  let appointmentsQuery=db('appointments').where({doctor_id:doctorId}).whereNot('status','cancelled');
  appointmentsQuery=clientName==='mysql2'?appointmentsQuery.whereRaw('DATE(??) = ?', ['start_at',date]):appointmentsQuery.where('start_at','>=',dayStart).where('start_at','<',dayEnd);
  const appointments=await appointmentsQuery;
  const intervals=appointments.map(a=>[new Date(a.start_at).getTime(),new Date(a.end_at).getTime()]);
  const step=15;let [sh,sm]=hours.start_time.split(':').map(Number);const [eh,em]=hours.end_time.split(':').map(Number);let cursor=sh*60+sm;const end=eh*60+em;const slots=[];
  while(cursor+step<=end){const hh=String(Math.floor(cursor/60)).padStart(2,'0');const mm=String(cursor%60).padStart(2,'0');const start=new Date(`${date}T${hh}:${mm}:00`);const finish=new Date(start.getTime()+step*60000);const busy=intervals.some(([a,b])=>start.getTime()<b&&finish.getTime()>a);const minLead=Date.now()+2*3600000;if(!busy&&start.getTime()>minLead)slots.push({startAt:start.toISOString(),endAt:finish.toISOString(),label:`${hh}:${mm}`});cursor+=step;}
  res.json({data:slots,working:true,workingHours:{start:hours.start_time,end:hours.end_time}});
}));

const config={
  services:{table:'services', input:z.object({name:z.string().trim().min(2).max(180),price:z.coerce.number().min(0),durationMinutes:z.coerce.number().int().min(5).max(240),color:z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#0F7778'),isActive:z.boolean().optional()}), columns:{name:'name',price:'price',durationMinutes:'duration_minutes',color:'color',isActive:'is_active'}},
  'lab-tests':{table:'lab_tests',input:z.object({nameAr:z.string().trim().min(2).max(180),nameEn:z.string().max(180).optional().nullable(),category:z.string().max(120).optional().nullable(),unit:z.string().max(40).optional().nullable(),refMin:z.coerce.number().optional().nullable(),refMax:z.coerce.number().optional().nullable(),refText:z.string().max(160).optional().nullable(),price:z.coerce.number().min(0).default(0),turnaroundHours:z.coerce.number().int().min(1).max(720).default(24),isActive:z.boolean().optional()}),columns:{nameAr:'name_ar',nameEn:'name_en',category:'category',unit:'unit',refMin:'ref_min',refMax:'ref_max',refText:'ref_text',price:'price',turnaroundHours:'turnaround_hours',isActive:'is_active'}},
  medications:{table:'medications',input:z.object({nameAr:z.string().trim().min(2).max(180),nameEn:z.string().max(180).optional().nullable(),brand:z.string().max(180).optional().nullable(),class:z.string().max(120).optional().nullable(),commonDoses:z.union([z.string(),z.array(z.string())]).optional(),isActive:z.boolean().optional()}),columns:{nameAr:'name_ar',nameEn:'name_en',brand:'brand',class:'class',commonDoses:'common_doses',isActive:'is_active'}}
};
const convertRow=(row,kind)=>{const c=config[kind];const out={id:row.id};for(const [camel,snake] of Object.entries(c.columns)){let value=row[snake];if(snake==='common_doses'&&typeof value==='string'){try{value=JSON.parse(value)}catch{}}out[camel]=value;}if(kind==='services')out.active=Boolean(row.is_active);else out.isActive=Boolean(row.is_active);return out;};

for(const [path,kind] of Object.entries({services:'services','lab-tests':'lab-tests',medications:'medications'})){
  const {table}=config[kind];
  router.get(`/${path}`,requirePermission('catalogs.read'),asyncHandler(async(req,res)=>{
    const {page,pageSize,offset}=pagination(req.query);let query=db(table);if(kind==='services')query=query.where({is_active:true});if(kind!=='services'&&req.query.all!=='true')query=query.where({is_active:true});const q=String(req.query.q||'').trim();if(q){const columns=kind==='services'?['name']:kind==='lab-tests'?['name_ar','name_en','category']:['name_ar','name_en','brand'];query=query.andWhere(b=>{columns.forEach((c,i)=>i?b.orWhere(c,'like',`%${q}%`):b.where(c,'like',`%${q}%`));});}
    const count=await query.clone().count({count:'*'}).first();const rows=await query.clone().orderBy(kind==='services'?'name':kind==='lab-tests'?'name_ar':'name_ar').limit(pageSize).offset(offset);res.json(pageResult(rows.map(x=>convertRow(x,kind)),Number(count.count),page,pageSize));
  }));
  router.post(`/${path}`,requirePermission('catalogs.write'),asyncHandler(async(req,res)=>{
    const input=config[kind].input.parse(req.body);const row={};for(const [key,value] of Object.entries(input)){const col=config[kind].columns[key];if(col)row[col]=key==='commonDoses'&&Array.isArray(value)?JSON.stringify(value):value;}
    if(kind==='services')row.clinic_id=req.user.clinic_id;if(kind==='medications'&&Array.isArray(input.commonDoses))row.common_doses=JSON.stringify(input.commonDoses);
    const id=await insertAndGetId(db(table).insert(row));await audit(req,`${kind}.create`,kind,id);res.status(201).json({data:convertRow(await db(table).where({id}).first(),kind)});
  }));
  router.patch(`/${path}/:id`,requirePermission('catalogs.write'),asyncHandler(async(req,res)=>{
    const id=idParam(req.params.id);const partial=config[kind].input.partial().parse(req.body);const update={updated_at:db.fn.now()};for(const [key,value] of Object.entries(partial)){const col=config[kind].columns[key];if(col)update[col]=key==='commonDoses'&&Array.isArray(value)?JSON.stringify(value):value;}await db(table).where({id}).update(update);const row=await db(table).where({id}).first();if(!row)throw new HttpError(404,'CATALOG_NOT_FOUND','العنصر غير موجود.');await audit(req,`${kind}.update`,kind,id,{fields:Object.keys(partial)});res.json({data:convertRow(row,kind)});
  }));
  router.delete(`/${path}/:id`,requirePermission('catalogs.write'),asyncHandler(async(req,res)=>{const id=idParam(req.params.id);const row=await db(table).where({id}).first();if(!row)throw new HttpError(404,'CATALOG_NOT_FOUND','العنصر غير موجود.');await db(table).where({id}).update({is_active:false,updated_at:db.fn.now()});await audit(req,`${kind}.archive`,kind,id);res.json({message:'تم إيقاف العنصر دون حذف السجلات المرتبطة.'});}));
}

export default router;
