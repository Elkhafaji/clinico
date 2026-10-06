import { db } from '../db/knex.js';

export async function audit(req, action, entity = null, entityId = null, meta = null) {
  try {
    await db('audit_logs').insert({
      user_id: req.user?.id || null,
      action,
      entity,
      entity_id: entityId == null ? null : String(entityId),
      meta: meta ? JSON.stringify(meta) : null,
      ip: req.ip || req.socket?.remoteAddress || null
    });
  } catch (error) {
    req.log?.error({ err: error }, 'audit write failed');
  }
}

export async function notify(userId, type, title, body, link = null) {
  if (!userId) return;
  await db('notifications').insert({ user_id: userId, type, title, body, link, channel_status: JSON.stringify({ inApp: 'queued' }) });
}
