import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { db } from '../db/knex.js';
import { insertAndGetId } from '../db/insert-id.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError, idParam } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const router=Router();
if (!env.fileStorageEnabled) {
 router.use((req,res)=>res.status(503).json({error:{code:'FILE_STORAGE_DISABLED',message:'رفع وتنزيل الملفات الطبية متوقف مؤقتًا على هذه النسخة.'}}));
} else {
router.use(requireAuth);fs.mkdirSync(env.uploadDir,{recursive:true});
const allowed=new Map([['application/pdf','.pdf'],['image/jpeg','.jpg'],['image/png','.png'],['image/webp','.webp'],['audio/webm','.webm'],['audio/wav','.wav'],['audio/mpeg','.mp3'],['text/plain','.txt']]);
const storage=multer.diskStorage({destination:(req,file,cb)=>cb(null,env.uploadDir),filename:(req,file,cb)=>cb(null,`${crypto.randomUUID()}${allowed.get(file.mimetype)||'.bin'}`)});
const upload=multer({storage,limits:{fileSize:10*1024*1024,files:1},fileFilter:(req,file,cb)=>{const ext=path.extname(file.originalname).toLowerCase();const allowedExt=[...allowed.values()];if(!allowed.has(file.mimetype)||!allowedExt.includes(ext))return cb(new HttpError(415,'FILE_TYPE_NOT_ALLOWED','الملف يجب أن يكون PDF أو صورة أو ملفًا صوتيًا مسموحًا.'));cb(null,true);}});
const wrappedUpload=(req,res,next)=>upload.single('file')(req,res,(error)=>{if(error)return next(error instanceof multer.MulterError?new HttpError(413,'UPLOAD_FAILED','حجم الملف أكبر من 10 ميجابايت أو أن الطلب غير صالح.'):error);next();});

router.post('/',wrappedUpload,asyncHandler(async(req,res)=>{
 if(!req.file)throw new HttpError(422,'FILE_REQUIRED','اختر ملفًا للرفع.');let patientId=req.body.patientId?Number(req.body.patientId):null;
 if(req.user.role==='patient'){const patient=await db('patients').where({user_id:req.user.id}).first();patientId=patient?.id;if(!patientId){await fsPromises.unlink(req.file.path);throw new HttpError(404,'PATIENT_NOT_FOUND','ملف المريض غير موجود.');}}
 if(patientId&&!await db('patients').where({id:patientId}).first()){await fsPromises.unlink(req.file.path);throw new HttpError(404,'PATIENT_NOT_FOUND','المريض غير موجود.');}
 const kind=String(req.body.kind||'document').slice(0,80);const id=await insertAndGetId(db('files').insert({owner_id:req.user.id,patient_id:patientId,path:req.file.path,original_name:path.basename(req.file.originalname).slice(0,255),mime:req.file.mimetype,size:req.file.size,kind,uploaded_by:req.user.id}));await audit(req,'file.upload','file',id,{kind,mime:req.file.mimetype,size:req.file.size});res.status(201).json({data:{id,originalName:path.basename(req.file.originalname),mime:req.file.mimetype,size:req.file.size,kind}});
}));
router.get('/:id',asyncHandler(async(req,res)=>{
 const id=idParam(req.params.id);const file=await db('files').where({id}).first();if(!file)throw new HttpError(404,'FILE_NOT_FOUND','الملف غير موجود.');
 if(req.user.role==='patient'){const patient=await db('patients').where({user_id:req.user.id}).first();if(Number(patient?.id)!==Number(file.patient_id)&&Number(file.owner_id)!==Number(req.user.id))throw new HttpError(404,'FILE_NOT_FOUND','الملف غير موجود.');}
 await audit(req,'file.read','file',id);res.setHeader('Content-Type',file.mime);res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);res.setHeader('X-Content-Type-Options','nosniff');const stream=fs.createReadStream(file.path);stream.on('error',()=>{if(!res.headersSent)res.status(404).json({error:{code:'FILE_MISSING',message:'الملف غير متاح.'}});});stream.pipe(res);
}));
router.delete('/:id',asyncHandler(async(req,res)=>{const id=idParam(req.params.id);const file=await db('files').where({id}).first();if(!file)throw new HttpError(404,'FILE_NOT_FOUND','الملف غير موجود.');if(req.user.role!=='admin'&&Number(file.owner_id)!==Number(req.user.id))throw new HttpError(403,'FORBIDDEN','لا يمكنك حذف هذا الملف.');await db('files').where({id}).delete();await fsPromises.unlink(file.path).catch(()=>{});await audit(req,'file.delete','file',id);res.json({message:'تم حذف الملف.'});}));
}

export default router;
