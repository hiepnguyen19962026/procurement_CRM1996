import {
  insertClientLegalHistorySQL,
  listClientLegalHistorySQL,
} from '../db/client-legal-history-queries.js';
import { ALL_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanString } from '../lib/normalize.js';
import { json, makeId, nowIso, readJson } from '../lib/utils.js';

export async function handleClientLegalHistory(action, request, env, ctx, actor) {
  if (action === 'getClientLegalHistory') return listHistory(request, env, actor);
  if (action === 'addClientLegalHistory') return addHistory(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown legal history action' }, 400);
}

async function listHistory(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  if (!p.clientId) return json({ ok: false, error: 'clientId la bat buoc' }, 400);
  const data = await listClientLegalHistorySQL(env.DB, { clientId: p.clientId });
  return json({ ok: true, ...data });
}

async function addHistory(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const clientId = cleanString(body.clientId || body.client_id, 50);
  if (!clientId) return json({ ok: false, error: 'clientId la bat buoc' }, 400);
  const effectiveDate = cleanString(body.effectiveDate || body.effective_date, 20);
  if (!effectiveDate) return json({ ok: false, error: 'effective_date la bat buoc' }, 400);

  const cs = (val, max) => cleanString(val, max);
  const now = nowIso();
  const row = {
    legal_history_id: makeId('LH'),
    client_id:        clientId,
    effective_date:   effectiveDate,
    legal_name:       cs(body.legalName || body.legal_name, 250),
    tax_code:         cs(body.taxCode || body.tax_code, 50),
    address:          cs(body.address, 500),
    note:             cs(body.note, 1000),
    created_by:       actor?.id || '',
    created_at:       now,
  };

  await insertClientLegalHistorySQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: 'addClientLegalHistory',
    entityType: 'client_legal_history',
    entityId: row.legal_history_id,
    newJson: row,
    actor,
  }));
  return json({ ok: true, record: row });
}
