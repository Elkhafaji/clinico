import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { insertAndGetId } from '../db/insert-id.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError, idParam, pagination, pageResult } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const router=Router();router.use(requireAuth,requireRole('admin'));
const toUser=(u)=>({id:u.id,fullName:u.full_name,role:u.role,email:u.email,phone:u.phone,status:u.status,lastLoginAt:u.last_login_at,mustChangePassword:Boolean(u.must_change_password),language:u.language,theme:u.theme,createdAt:u.created_at});
const oneTimePassword=()=>crypto.randomBytes(9).toString('base64url');

router.get('/',asyncHandler(async(req,res)=>{
  const {page,pageSize,offset}=pagination(req.query);const q=String(req.query.q||'').trim();let query=db('users').whereNull('deleted_at');if(req.query.role)query=query.where({role:String(req.query.role)});if(req.query.status)query=query.where({status:String(req.query.status)});if(q)query=query.andWhere(b=>b.where('full_name','like',`%${q}%`).orWhere('email','like',`%${q}%`).orWhere('phone','like',`%${q}%`));
  const count=await query.clone().count({count:'*'}).first();const users=await query.clone().orderBy('created_at','desc').limit(pageSize).offset(offset);await audit(req,'user.list.read','user',null,{count:users.length});res.json(pageResult(users.map(toUser),Number(count.count),page,pageSize));
}));

router.post('/',asyncHandler(async(req,res)=>{
  const input=z.object({fullName:z.string().trim().min(2).max(180),role:z.enum(['admin','doctor','receptionist','patient']),email:z.union([z.string().email(),z.literal('')]).optional(),phone:z.string().trim().max(32).optional().or(z.literal('')),password:z.string().min(8).max(128).optional(),specialty:z.string().max(160).optional(),avgVisitMinutes:z.coerce.number().int().min(5).max(120).optional()}).parse(req.body);
  if(!input.email&&!input.phone)throw new HttpError(422,'CONTACT_REQUIRED','أدخل البريد الإلكتروني أو رقم الهاتف.');
  const duplicate=await db('users').whereNull('deleted_at').andWhere(b=>{if(input.email)b.where({email:input.email});if(input.email&&input.phone)b.orWhere({phone:input.phone});else if(input.phone)b.where({phone:input.phone});}).first();if(duplicate)throw new HttpError(409,'ACCOUNT_EXISTS','البريد أو الهاتف مستخدم في حساب آخر.');
  const password=input.password||oneTimePassword();const mustChange=!input.password;
  const id=await db.transaction(async trx=>{
    const userId=await insertAndGetId(trx('users').insert({clinic_id:req.user.clinic_id,role:input.role,full_name:input.fullName,email:input.email||null,phone:input.phone||null,password_hash:await bcrypt.hash(password,12),status:'active',must_change_password:mustChange}));
    if(input.role==='doctor'){
      await trx('doctor_profiles').insert({user_id:userId,clinic_id:req.user.clinic_id,specialty:input.specialty||'طب الأسرة',avg_visit_minutes:input.avgVisitMinutes||15});
      for(let weekday=0;weekday<7;weekday++)await trx('working_hours').insert({doctor_id:userId,weekday,is_open:weekday!==6,start_time:'09:00',end_time:'17:00'});
    }
    return userId;
  });
  await audit(req,'user.create','user',id,{role:input.role});const user=await db('users').where({id}).first();res.status(201).json({data:toUser(user), ...(mustChange?{temporaryPassword:password}:{}), message:mustChange?'تم تفعيل الحساب. أرسل كلمة المرور المؤقتة للمستخدم عبر قناة آمنة.':'تم إنشاء الحساب.'});
}));

router.get('/:id',asyncHandler(async(req,res)=>{const id=idParam(req.params.id);const u=await db('users').where({id}).whereNull('deleted_at').first();if(!u)throw new HttpError(404,'USER_NOT_FOUND','الحساب غير موجود.');const profile=u.role==='doctor'?await db('doctor_profiles').where({user_id:id}).first():null;res.json({data:{...toUser(u),specialty:profile?.specialty||null,avgVisitMinutes:profile?.avg_visit_minutes||null}});}));
router.patch('/:id',asyncHandler(async(req,res)=>{
  const id=idParam(req.params.id);const u=await db('users').where({id}).whereNull('deleted_at').first();if(!u)throw new HttpError(404,'USER_NOT_FOUND','الحساب غير موجود.');
  const input=z.object({fullName:z.string().trim().min(2).max(180).optional(),email:z.union([z.string().email(),z.literal('')]).optional(),phone:z.string().trim().max(32).optional().or(z.literal('')),status:z.enum(['active','suspended']).optional(),specialty:z.string().max(160).optional(),avgVisitMinutes:z.coerce.number().int().min(5).max(120).optional()}).parse(req.body);
  const update={updated_at:db.fn.now()};if(input.fullName!==undefined)update.full_name=input.fullName;if(input.email!==undefined)update.email=input.email||null;if(input.phone!==undefined)update.phone=input.phone||null;if(input.status!==undefined){if(id===req.user.id&&input.status==='suspended')throw new HttpError(422,'CANNOT_SUSPEND_SELF','لا يمكن إيقاف حسابك الحالي.');update.status=input.status;}
  await db('users').where({id}).update(update);if(u.role==='doctor'&&(input.specialty!==undefined||input.avgVisitMinutes!==undefined))await db('doctor_profiles').where({user_id:id}).update({...(input.specialty!==undefined?{specialty:input.specialty}:{}),...(input.avgVisitMinutes!==undefined?{avg_visit_minutes:input.avgVisitMinutes}:{}),updated_at:db.fn.now()});
  await audit(req,'user.update','user',id,{fields:Object.keys(input)});res.json({data:toUser(await db('users').where({id}).first())});
}));
router.post('/:id/suspend',asyncHandler(async(req,res)=>{const id=idParam(req.params.id);if(id===req.user.id)throw new HttpError(422,'CANNOT_SUSPEND_SELF','لا يمكن إيقاف حسابك الحالي.');const u=await db('users').where({id}).whereNull('deleted_at').first();if(!u)throw new HttpError(404,'USER_NOT_FOUND','الحساب غير موجود.');await db('users').where({id}).update({status:'suspended',updated_at:db.fn.now()});await db('refresh_tokens').where({user_id:id}).whereNull('revoked_at').update({revoked_at:db.fn.now(),updated_at:db.fn.now()});await audit(req,'user.suspend','user',id);res.json({message:'تم إيقاف الحساب وإلغاء جلساته.'});}));
router.post('/:id/activate',asyncHandler(async(req,res)=>{const id=idParam(req.params.id);const u=await db('users').where({id}).whereNull('deleted_at').first();if(!u)throw new HttpError(404,'USER_NOT_FOUND','الحساب غير موجود.');await db('users').where({id}).update({status:'active',updated_at:db.fn.now()});await audit(req,'user.activate','user',id);res.json({message:'تم تفعيل الحساب.'});}));
router.post('/:id/reset-password',asyncHandler(async(req,res)=>{const id=idParam(req.params.id);const u=await db('users').where({id}).whereNull('deleted_at').first();if(!u)throw new HttpError(404,'USER_NOT_FOUND','الحساب غير موجود.');const password=oneTimePassword();await db('users').where({id}).update({password_hash:await bcrypt.hash(password,12),must_change_password:true,updated_at:db.fn.now()});await db('refresh_tokens').where({user_id:id}).whereNull('revoked_at').update({revoked_at:db.fn.now(),updated_at:db.fn.now()});await audit(req,'user.password.reset','user',id);res.json({temporaryPassword:password,message:'تم إنشاء كلمة مرور مؤقتة. اعرضها مرة واحدة وأرسلها للمستخدم عبر قناة آمنة.'});}));
router.delete('/:id',asyncHandler(async(req,res)=>{const id=idParam(req.params.id);if(id===req.user.id)throw new HttpError(422,'CANNOT_DELETE_SELF','لا يمكن أرشفة حسابك الحالي.');const u=await db('users').where({id}).whereNull('deleted_at').first();if(!u)throw new HttpError(404,'USER_NOT_FOUND','الحساب غير موجود.');await db('users').where({id}).update({deleted_at:db.fn.now(),status:'suspended',updated_at:db.fn.now()});await db('refresh_tokens').where({user_id:id}).whereNull('revoked_at').update({revoked_at:db.fn.now(),updated_at:db.fn.now()});await audit(req,'user.archive','user',id);res.json({message:'تمت أرشفة الحساب.'});}));

export default router;
