import { getClientSQL, insertClientSQL, listClientsSQL, updateClientSQL } from '../db/client-queries.js';
import { ALL_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { buildSearchText, cleanString, normalizeText } from '../lib/normalize.js';
import { clampLimit, json, nextEntityId, nowIso, readJson } from '../lib/utils.js';

export async function handleClients(action, request, env, ctx, actor) {
  if (action === 'getClients') return listClients(request, env, actor);
  if (action === 'createClient') return saveClient(request, env, ctx, actor, false);
  if (action === 'updateClient') return saveClient(request, env, ctx, actor, true);
  return json({ ok: false, error: 'Unknown client action' }, 400);
}

async function listClients(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const data = await listClientsSQL(env.DB, { q: normalizeText(p.q), cursor: p.cursor || '', sortBy: p.sortBy || '', sortDir: p.sortDir || '', limit: clampLimit(p.limit) });
  return json({ ok: true, ...data });
}

async function saveClient(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const name = cleanString(body.clientName || body.client_name, 180);
  if (!name) return json({ ok: false, error: 'Ten CDT/khach hang la bat buoc' }, 400);
  const now = nowIso();
  const oldRow = isUpdate ? await getClientSQL(env.DB, body.clientId || body.client_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: 'Khong tim thay client' }, 404);
  const row = {
    client_id: isUpdate ? oldRow.client_id : await nextEntityId(env.DB, 'clients', 'client_id', 'CL'),
    client_name: name,
    plant_name: cleanString(body.plantName || body.plant_name, 180),
    province: cleanString(body.province, 80),
    note: cleanString(body.note, 1000),
    normalized_search: buildSearchText([name, body.plantName, body.plant_name, body.province]),
    created_at: oldRow?.created_at || now,
    updated_at: now,
  };
  if (isUpdate) await updateClientSQL(env.DB, row);
  else await insertClientSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, { action: isUpdate ? 'updateClient' : 'createClient', entityType: 'client', entityId: row.client_id, oldJson: oldRow, newJson: row, actor }));
  return json({ ok: true, client: row });
}
