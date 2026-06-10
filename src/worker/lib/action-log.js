import { makeId, nowIso, publicActorName } from './utils.js';
import { insertAuditLogSQL } from '../db/audit-queries.js';

export async function writeActionLog(env, opts = {}) {
  const actor = opts.actor || {};
  const row = {
    audit_id: makeId('AUDIT'),
    action: opts.action || 'unknown',
    entity_type: opts.entityType || '',
    entity_id: opts.entityId || '',
    message: opts.message || `${publicActorName(actor)} thuc hien ${opts.action || 'unknown'}`,
    old_json: opts.oldJson ? JSON.stringify(opts.oldJson) : '',
    new_json: opts.newJson ? JSON.stringify(opts.newJson) : '',
    actor_id: actor.id || '',
    actor_name: publicActorName(actor),
    created_at: nowIso(),
  };
  await insertAuditLogSQL(env.DB, row);
  return row;
}
