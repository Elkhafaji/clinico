import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db/knex.js';
import { env } from './config/env.js';
import authRoutes from './modules/auth.js';
import userRoutes from './modules/users.js';
import patientRoutes from './modules/patients.js';
import appointmentRoutes from './modules/appointments.js';
import queueRoutes from './modules/queue.js';
import catalogRoutes from './modules/catalogs.js';
import billingRoutes from './modules/billing.js';
import clinicalRoutes from './modules/clinical.js';
import generalRoutes from './modules/general.js';
import fileRoutes from './modules/files.js';
import { errorHandler, notFound } from './utils/http.js';

const app=express();app.disable('x-powered-by');app.set('trust proxy',env.nodeEnv==='production'?1:false);
app.use(pinoHttp({redact:['req.headers.authorization','req.headers.cookie','res.headers["set-cookie"]'],customProps:(req)=>({requestId:req.id})}));
app.use(helmet({contentSecurityPolicy:env.nodeEnv==='production'?{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],styleSrcAttr:["'unsafe-inline'"],imgSrc:["'self'",'data:','blob:'],fontSrc:["'self'",'data:'],connectSrc:["'self'"],objectSrc:["'none'"],baseUri:["'self'"],formAction:["'self'"],frameAncestors:["'self'"]}}:false,crossOriginResourcePolicy:{policy:'cross-origin'}}));
const vercelOrigins=[env.vercelUrl,env.vercelBranchUrl,env.vercelProjectProductionUrl].filter(Boolean).map((host)=>`https://${host}`);
app.use(cors({origin(origin,callback){if(!origin||origin===env.appOrigin||vercelOrigins.includes(origin)||env.nodeEnv!=='production'&&/^https:\/\/[a-z0-9-]+\.e2b\.app$/i.test(origin))return callback(null,true);return callback(new Error('Origin not allowed'));},credentials:true}));
app.use(express.json({limit:'1mb'}));app.use(express.urlencoded({extended:false,limit:'1mb'}));app.use(cookieParser());
const authLimiter=rateLimit({windowMs:15*60*1000,limit:100,standardHeaders:true,legacyHeaders:false,message:{error:{code:'RATE_LIMIT',message:'عدد المحاولات كبير. حاول لاحقًا.'}}});
app.get('/api/v1/health',async(req,res)=>{try{await db.raw('SELECT 1');res.json({status:'ok',database:'connected',environment:env.nodeEnv,now:new Date().toISOString()});}catch(error){req.log.error({err:error},'database health check failed');res.status(503).json({status:'error',database:'unavailable'});}});
app.use('/api/v1/auth',authLimiter,authRoutes);
app.use('/api/v1/files',fileRoutes);
app.use('/api/v1/users',userRoutes);
app.use('/api/v1/patients',patientRoutes);
app.use('/api/v1/appointments',appointmentRoutes);
app.use('/api/v1/queue',queueRoutes);
app.use('/api/v1',catalogRoutes);
app.use('/api/v1/invoices',billingRoutes);
app.use('/api/v1',clinicalRoutes);
app.use('/api/v1',generalRoutes);

if(env.nodeEnv==='production'||env.isVercel){
  const backendRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const frontendDist=path.resolve(backendRoot,'../frontend/dist');
  const staticRoot=env.isVercel?path.resolve(process.cwd(),'public'):frontendDist;
  app.use(express.static(staticRoot,{index:false,immutable:true,maxAge:'1d'}));
  app.get('*',(req,res,next)=>{if(req.path.startsWith('/api/'))return next();res.sendFile(path.join(staticRoot,'index.html'));});
}
app.use(notFound);app.use(errorHandler);

export default app;
