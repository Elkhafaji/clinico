import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { insertAndGetId } from '../db/insert-id.js';
import { env } from '../config/env.js';
import { asyncHandler, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { requireAuth, signAccessToken } from '../middleware/auth.js';

const router = Router();
const cookieName = 'clinico_refresh';
const cookieOptions = () => ({ httpOnly: true, secure: env.nodeEnv === 'production', sameSite: 'strict', path: '/api/v1/auth', maxAge: 30 * 24 * 60 * 60 * 1000 });
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const publicUser = (u) => ({ id: u.id, fullName: u.full_name, role: u.role, email: u.email, phone: u.phone, status: u.status, mustChangePassword: Boolean(u.must_change_password), language: u.language || 'ar', theme: u.theme || 'light', avatarPath: u.avatar_path || null });

async function createSession(user, req, res) {
  const jti = crypto.randomUUID();
  const refresh = jwt.sign({ sub: String(user.id), jti }, env.jwtRefreshSecret, { expiresIn: '30d', issuer: 'clinico-systems' });
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db('refresh_tokens').insert({ user_id: user.id, token_hash: sha256(refresh), user_agent: String(req.headers['user-agent'] || '').slice(0, 512), ip: req.ip, expires_at: expiresAt.toISOString() });
  res.cookie(cookieName, refresh, cookieOptions());
  return { accessToken: signAccessToken(user), user: publicUser(user) };
}

router.post('/login', asyncHandler(async (req, res) => {
  const input = z.object({ identifier: z.string().trim().min(3), password: z.string().min(1) }).parse(req.body);
  const user = await db('users').whereNull('deleted_at').andWhere((q) => q.where({ email: input.identifier }).orWhere({ phone: input.identifier })).first();
  if (!user) {
    await audit(req, 'auth.login.failed', 'user', null, { reason: 'unknown_identifier' });
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'بيانات الدخول غير صحيحة.');
  }
  if (user.status !== 'active') throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'الحساب موقوف. تواصل مع مسؤول العيادة.');
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) throw new HttpError(423, 'ACCOUNT_LOCKED', 'تم إيقاف المحاولات مؤقتًا. حاول بعد 15 دقيقة.');
  const valid = await bcrypt.compare(input.password, user.password_hash);
  if (!valid) {
    const failed = Number(user.failed_logins || 0) + 1;
    await db('users').where({ id: user.id }).update({ failed_logins: failed >= 5 ? 0 : failed, locked_until: failed >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null, updated_at: db.fn.now() });
    await audit(req, 'auth.login.failed', 'user', user.id, { reason: 'invalid_password' });
    throw new HttpError(failed >= 5 ? 423 : 401, failed >= 5 ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS', failed >= 5 ? 'تم إيقاف المحاولات مؤقتًا. حاول بعد 15 دقيقة.' : 'بيانات الدخول غير صحيحة.');
  }
  await db('users').where({ id: user.id }).update({ failed_logins: 0, locked_until: null, last_login_at: db.fn.now(), updated_at: db.fn.now() });
  const fresh = await db('users').where({ id: user.id }).first();
  const session = await createSession(fresh, req, res);
  await audit(req, 'auth.login.success', 'user', user.id);
  res.json(session);
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const raw = req.cookies?.[cookieName];
  if (!raw) throw new HttpError(401, 'REFRESH_REQUIRED', 'انتهت الجلسة. سجّل الدخول مرة أخرى.');
  let payload;
  try { payload = jwt.verify(raw, env.jwtRefreshSecret, { issuer: 'clinico-systems' }); }
  catch { res.clearCookie(cookieName, cookieOptions()); throw new HttpError(401, 'INVALID_REFRESH', 'انتهت الجلسة. سجّل الدخول مرة أخرى.'); }
  const stored = await db('refresh_tokens').where({ token_hash: sha256(raw), user_id: Number(payload.sub) }).whereNull('revoked_at').first();
  if (!stored || new Date(stored.expires_at).getTime() < Date.now()) { res.clearCookie(cookieName, cookieOptions()); throw new HttpError(401, 'INVALID_REFRESH', 'انتهت الجلسة. سجّل الدخول مرة أخرى.'); }
  const user = await db('users').where({ id: Number(payload.sub), status: 'active' }).whereNull('deleted_at').first();
  if (!user) { res.clearCookie(cookieName, cookieOptions()); throw new HttpError(401, 'ACCOUNT_INACTIVE', 'الحساب غير نشط.'); }
  await db('refresh_tokens').where({ id: stored.id }).update({ revoked_at: db.fn.now(), last_used_at: db.fn.now(), updated_at: db.fn.now() });
  const session = await createSession(user, req, res);
  res.json(session);
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const raw = req.cookies?.[cookieName];
  if (raw) await db('refresh_tokens').where({ token_hash: sha256(raw) }).whereNull('revoked_at').update({ revoked_at: db.fn.now(), updated_at: db.fn.now() });
  res.clearCookie(cookieName, cookieOptions());
  res.json({ message: 'تم تسجيل الخروج.' });
}));

router.post('/register', asyncHandler(async (req, res) => {
  const input = z.object({ firstName: z.string().trim().min(2).max(100), lastName: z.string().trim().min(2).max(100), email: z.string().trim().email().optional().or(z.literal('')), phone: z.string().trim().min(7).max(32).optional().or(z.literal('')), dob: z.string().optional().or(z.literal('')), sex: z.enum(['female','male','unspecified']).default('unspecified'), password: z.string().min(8).max(128), consent: z.literal(true) }).parse(req.body);
  if (!input.email && !input.phone) throw new HttpError(422, 'CONTACT_REQUIRED', 'أدخل البريد الإلكتروني أو رقم الهاتف.');
  const setting = await db('settings').where({ key: 'settings:booking' }).first();
  const booking = setting ? JSON.parse(setting.value) : { publicBooking: true };
  if (booking.publicRegistration === false) throw new HttpError(403, 'REGISTRATION_DISABLED', 'التسجيل العام غير متاح حاليًا.');
  const duplicate = await db('users').whereNull('deleted_at').andWhere((q) => { if (input.email) q.where({ email: input.email }); if (input.email && input.phone) q.orWhere({ phone: input.phone }); else if (input.phone) q.where({ phone: input.phone }); }).first();
  if (duplicate) throw new HttpError(409, 'ACCOUNT_EXISTS', 'البريد الإلكتروني أو الهاتف مسجل بالفعل.');
  const clinic = await db('clinics').first();
  const userId = await db.transaction(async (trx) => {
    const id = await insertAndGetId(trx('users').insert({ clinic_id: clinic?.id, role: 'patient', full_name: `${input.firstName} ${input.lastName}`, email: input.email || null, phone: input.phone || null, password_hash: await bcrypt.hash(input.password, 12), status: 'active', must_change_password: false }));
    const fileNo = `CLN-${Date.now().toString().slice(-10)}`;
    const patientId = await insertAndGetId(trx('patients').insert({ clinic_id: clinic?.id, user_id: id, file_no: fileNo, first_name: input.firstName, last_name: input.lastName, dob: input.dob || null, sex: input.sex, phone: input.phone || null, email: input.email || null, status: 'active' }));
    await trx('patient_medical').insert({ patient_id: patientId, allergy_flag: false });
    await trx('audit_logs').insert({ user_id: id, action: 'patient.register', entity: 'patient', entity_id: fileNo, meta: JSON.stringify({ consentAt: new Date().toISOString() }), ip: req.ip });
    return id;
  });
  const user = await db('users').where({ id: userId }).first();
  const session = await createSession(user, req, res);
  res.status(201).json(session);
}));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const input = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) }).parse(req.body);
  const valid = await bcrypt.compare(input.currentPassword, req.user.password_hash);
  if (!valid) throw new HttpError(422, 'CURRENT_PASSWORD_INVALID', 'كلمة المرور الحالية غير صحيحة.');
  if (input.currentPassword === input.newPassword) throw new HttpError(422, 'PASSWORD_REUSED', 'اختر كلمة مرور مختلفة عن الحالية.');
  const security = await db('settings').where({ key: 'settings:security' }).first();
  const policy = security ? JSON.parse(security.value) : { minPasswordLength: 8 };
  if (input.newPassword.length < Number(policy.minPasswordLength || 8)) throw new HttpError(422, 'PASSWORD_POLICY', `يجب أن تتكون كلمة المرور من ${policy.minPasswordLength || 8} أحرف على الأقل.`);
  await db('users').where({ id: req.user.id }).update({ password_hash: await bcrypt.hash(input.newPassword, 12), must_change_password: false, updated_at: db.fn.now() });
  await db('refresh_tokens').where({ user_id: req.user.id }).whereNull('revoked_at').update({ revoked_at: db.fn.now(), updated_at: db.fn.now() });
  res.clearCookie(cookieName, cookieOptions());
  await audit(req, 'auth.password.changed', 'user', req.user.id);
  res.json({ message: 'تم تحديث كلمة المرور. سجّل الدخول مرة أخرى.' });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => res.json({ user: publicUser(req.user) })));
router.patch('/profile', requireAuth, asyncHandler(async (req, res) => {
  const input = z.object({ fullName: z.string().trim().min(2).max(180).optional(), email: z.union([z.string().email(), z.literal('')]).optional(), phone: z.string().trim().max(32).optional().or(z.literal('')), language: z.enum(['ar','en']).optional(), theme: z.enum(['light','dark','system']).optional() }).parse(req.body);
  if (input.email || input.phone) {
    const duplicate = await db('users').whereNull('deleted_at').whereNot('id', req.user.id).andWhere((q) => { if (input.email) q.where({ email: input.email }); if (input.email && input.phone) q.orWhere({ phone: input.phone }); else if (input.phone) q.where({ phone: input.phone }); }).first();
    if (duplicate) throw new HttpError(409, 'ACCOUNT_EXISTS', 'البريد أو الهاتف مستخدم في حساب آخر.');
  }
  const update = { updated_at: db.fn.now() };
  for (const key of ['fullName','email','phone','language','theme']) if (Object.hasOwn(input, key)) update[{fullName:'full_name'}[key] || key] = input[key] || (key === 'email' || key === 'phone' ? null : input[key]);
  await db('users').where({ id: req.user.id }).update(update);
  await audit(req, 'profile.update', 'user', req.user.id, { fields: Object.keys(input) });
  const user = await db('users').where({ id: req.user.id }).first();
  res.json({ user: publicUser(user), message: 'تم حفظ الملف الشخصي.' });
}));
router.get('/sessions', requireAuth, asyncHandler(async (req, res) => {
  const sessions = await db('refresh_tokens').select('id','user_agent','ip','expires_at','last_used_at','created_at').where({ user_id: req.user.id }).whereNull('revoked_at').orderBy('created_at','desc');
  res.json({ data: sessions });
}));
router.post('/forgot', asyncHandler(async (req, res) => {
  z.object({ identifier: z.string().trim().min(3) }).parse(req.body);
  // Deliberately generic: connect SMTP in production; do not disclose whether an account exists.
  res.json({ message: 'إذا كانت البيانات مرتبطة بحساب، ستصل تعليمات الاستعادة عبر قناة التواصل المسجلة.' });
}));
router.post('/reset', asyncHandler(async (req, res) => { throw new HttpError(501, 'RESET_LINK_REQUIRED', 'رابط الاستعادة غير صالح أو منتهي.'); }));

export default router;
