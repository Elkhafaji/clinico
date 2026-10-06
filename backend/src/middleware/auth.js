import jwt from 'jsonwebtoken';
import { db } from '../db/knex.js';
import { env } from '../config/env.js';
import { HttpError, asyncHandler } from '../utils/http.js';

export function signAccessToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role, clinicId: user.clinic_id }, env.jwtAccessSecret, { expiresIn: '15m', issuer: 'clinico-systems' });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret, { issuer: 'clinico-systems' });
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'AUTH_REQUIRED', 'سجّل الدخول للمتابعة.');
  let claims;
  try { claims = verifyAccessToken(token); } catch { throw new HttpError(401, 'INVALID_TOKEN', 'انتهت الجلسة أو أن رمز الدخول غير صالح.'); }
  const user = await db('users').where({ id: Number(claims.sub) }).whereNull('deleted_at').first();
  if (!user || user.status !== 'active') throw new HttpError(401, 'ACCOUNT_INACTIVE', 'الحساب غير نشط. تواصل مع مسؤول العيادة.');
  req.user = user;
  next();
});

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, 'FORBIDDEN', 'ليست لديك الصلاحية لتنفيذ هذا الإجراء.'));
  next();
};

const defaults = {
  admin: ['*'],
  doctor: ['patients.read','patients.write','appointments.read','appointments.write','queue.read','queue.manage','visits.read','visits.write','prescriptions.read','prescriptions.write','labs.read','labs.write','catalogs.read','messages.read','messages.write','reports.clinical','settings.profile'],
  receptionist: ['patients.read','patients.write','appointments.read','appointments.write','queue.read','queue.manage','labs.read','labs.collect','prescriptions.read','invoices.read','invoices.write','payments.write','catalogs.read','messages.read','messages.write','settings.profile'],
  patient: ['patient.self','patients.read','patients.write','appointments.read','appointments.write','queue.read','prescriptions.read','labs.read','invoices.read','messages.read','messages.write','settings.profile']
};

export const requirePermission = (permission) => asyncHandler(async (req, res, next) => {
  if (req.user.role === 'admin') return next();
  const dbPermission = await db('role_permissions').where({ role: req.user.role, permission_key: permission, allowed: true }).first();
  const allowed = dbPermission || defaults[req.user.role]?.includes(permission);
  if (!allowed) throw new HttpError(403, 'FORBIDDEN', 'ليست لديك الصلاحية لتنفيذ هذا الإجراء.');
  next();
});

export function ensurePatientAccess(patient, user) {
  if (user.role === 'patient' && Number(patient.user_id) !== Number(user.id)) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'ملف المريض غير موجود.');
}
