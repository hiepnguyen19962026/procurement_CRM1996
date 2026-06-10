import { listAuditLogsSQL } from '../db/audit-queries.js';
import { ADMIN_ROLES, MANAGE_ROLES, requireRole } from '../lib/auth.js';
import { clampLimit, json, readJson } from '../lib/utils.js';

export async function handleAudit(action, request, env, ctx, actor) {
  if (action !== 'getAuditLogs') return json({ ok: false, error: 'Unknown audit action' }, 400);
  const allowed = actor?.role === 'admin' ? ADMIN_ROLES : MANAGE_ROLES;
  const denied = requireRole(actor, allowed);
  if (denied) return denied;
  const p = await readJson(request);
  const data = await listAuditLogsSQL(env.DB, { q: p.q || '', cursor: p.cursor || '', limit: clampLimit(p.limit) });
  return json({ ok: true, ...data });
}
