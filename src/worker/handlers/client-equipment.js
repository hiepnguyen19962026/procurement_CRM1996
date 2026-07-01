import {
  archiveClientEquipmentSQL,
  getClientEquipmentSQL,
  insertClientEquipmentSQL,
  listClientEquipmentSQL,
  updateClientEquipmentSQL,
} from '../db/client-equipment-queries.js';
import { ALL_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { consumeKvRateLimit } from '../lib/cache.js';
import { buildSearchText, cleanString, normalizeText } from '../lib/normalize.js';
import { json, makeId, nowIso, readJson } from '../lib/utils.js';

const VALID_GROUPS = new Set([
  'turbine', 'generator', 'boiler', 'heater', 'primary_fan', 'secondary_fan',
  'coal_mill', 'gearbox', 'condenser', 'feed_pump', 'transformer', 'pump', 'motor', 'valve', 'other',
]);

export async function handleClientEquipment(action, request, env, ctx, actor) {
  if (action === 'getClientEquipment')     return listEquipment(request, env, actor);
  if (action === 'createClientEquipment')  return saveEquipment(request, env, ctx, actor, false);
  if (action === 'updateClientEquipment')  return saveEquipment(request, env, ctx, actor, true);
  if (action === 'archiveClientEquipment') return archiveEquipment(request, env, ctx, actor);
  if (action === 'importClientEquipment')  return importEquipment(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown equipment action' }, 400);
}

async function listEquipment(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = request.method === 'GET'
    ? Object.fromEntries(new URL(request.url).searchParams)
    : await readJson(request);
  if (!p.clientId) return json({ ok: false, error: 'clientId la bat buoc' }, 400);
  const data = await listClientEquipmentSQL(env.DB, {
    clientId: p.clientId,
    q: p.q ? normalizeText(p.q) : null,
    limit: p.limit,
  });
  return json({ ok: true, ...data });
}

async function saveEquipment(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);

  const group = cleanString(body.equipmentGroup || body.equipment_group, 50).toLowerCase();
  if (!VALID_GROUPS.has(group)) {
    return json({ ok: false, error: `equipment_group khong hop le. Hop le: ${[...VALID_GROUPS].join(', ')}` }, 400);
  }
  const clientId = cleanString(body.clientId || body.client_id, 50);
  if (!clientId) return json({ ok: false, error: 'clientId la bat buoc' }, 400);

  const now = nowIso();
  const oldRow = isUpdate ? await getClientEquipmentSQL(env.DB, body.equipmentId || body.equipment_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: 'Khong tim thay thiet bi' }, 404);

  const cs = (val, max) => cleanString(val, max);
  const row = {
    equipment_id:             isUpdate ? oldRow.equipment_id : makeId('EQ'),
    client_id:                isUpdate ? oldRow.client_id : clientId,
    plant_name:               cs(body.plantName || body.plant_name, 120),
    unit_no:                  cs(body.unitNo || body.unit_no, 80),
    system_area:              cs(body.systemArea || body.system_area, 120),
    equipment_group:          group,
    equipment_name:           cs(body.equipmentName || body.equipment_name, 200),
    equipment_tag:            cs(body.equipmentTag || body.equipment_tag, 80),
    oem_manufacturer:         cs(body.oemManufacturer || body.oem_manufacturer, 150),
    oem_model:                cs(body.oemModel || body.oem_model, 200),
    oem_spec:                 cs(body.oemSpec || body.oem_spec, 500),
    oem_part_no:              cs(body.oemPartNo || body.oem_part_no, 150),
    replacement_manufacturer: cs(body.replacementManufacturer || body.replacement_manufacturer, 150),
    replacement_model:        cs(body.replacementModel || body.replacement_model, 200),
    replacement_spec:         cs(body.replacementSpec || body.replacement_spec, 500),
    replacement_part_no:      cs(body.replacementPartNo || body.replacement_part_no, 150),
    critical_level:           ['critical', 'normal', 'low'].includes(body.criticalLevel || body.critical_level)
                                ? (body.criticalLevel || body.critical_level) : 'normal',
    status:                   isUpdate ? (oldRow.status || 'active') : 'active',
    note:                     cs(body.note, 1000),
    normalized_search:        buildSearchText([
      body.plantName || body.plant_name,
      body.unitNo || body.unit_no,
      group,
      body.equipmentName || body.equipment_name,
      body.equipmentTag || body.equipment_tag,
      body.oemManufacturer || body.oem_manufacturer,
      body.oemModel || body.oem_model,
      body.oemSpec || body.oem_spec,
      body.oemPartNo || body.oem_part_no,
      body.replacementManufacturer || body.replacement_manufacturer,
      body.replacementModel || body.replacement_model,
      body.replacementSpec || body.replacement_spec,
      body.replacementPartNo || body.replacement_part_no,
    ]),
    created_by: isUpdate ? oldRow.created_by : (actor?.id || ''),
    created_at: isUpdate ? oldRow.created_at : now,
    updated_at: now,
  };

  if (isUpdate) await updateClientEquipmentSQL(env.DB, row);
  else await insertClientEquipmentSQL(env.DB, row);

  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? 'updateClientEquipment' : 'createClientEquipment',
    entityType: 'client_equipment',
    entityId: row.equipment_id,
    oldJson: oldRow,
    newJson: row,
    actor,
  }));
  return json({ ok: true, equipment: row });
}

async function archiveEquipment(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const id = cleanString(body.equipmentId || body.equipment_id, 50);
  if (!id) return json({ ok: false, error: 'equipmentId la bat buoc' }, 400);
  const oldRow = await getClientEquipmentSQL(env.DB, id);
  if (!oldRow) return json({ ok: false, error: 'Khong tim thay thiet bi' }, 404);
  const now = nowIso();
  await archiveClientEquipmentSQL(env.DB, id, now);
  ctx.waitUntil(writeActionLog(env, {
    action: 'archiveClientEquipment',
    entityType: 'client_equipment',
    entityId: id,
    oldJson: oldRow,
    newJson: { ...oldRow, status: 'archived', updated_at: now },
    actor,
  }));
  return json({ ok: true });
}

async function importEquipment(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const rate = await consumeKvRateLimit(env, `s2b1:importClientEquipment:actor:${actor.id}`, 10, 600);
  if (!rate.allowed) return json({ ok: false, error: 'Qua nhieu yeu cau import', retryAfter: rate.retryAfter }, 429, { 'retry-after': String(rate.retryAfter) });
  const body = await readJson(request);
  const clientId = cleanString(body.clientId || body.client_id, 50);
  if (!clientId) return json({ ok: false, error: 'clientId la bat buoc' }, 400);
  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  if (!rawRows.length) return json({ ok: false, error: 'Khong co du lieu de nhap' }, 400);
  if (rawRows.length > 500) return json({ ok: false, error: 'Toi da 500 dong moi lan nhap' }, 400);

  const now = nowIso();
  const results = { created: 0, errors: [] };

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const cs = (val, max) => cleanString(val, max);
    const group = cs(r.equipment_group, 50).toLowerCase();
    if (!VALID_GROUPS.has(group)) {
      results.errors.push(`Dong ${i + 1}: equipment_group "${group}" khong hop le`);
      continue;
    }
    const row = {
      equipment_id:             makeId('EQ'),
      client_id:                clientId,
      plant_name:               cs(r.plant_name, 120),
      unit_no:                  cs(r.unit_no, 80),
      system_area:              cs(r.system_area, 120),
      equipment_group:          group,
      equipment_name:           cs(r.equipment_name, 200),
      equipment_tag:            cs(r.equipment_tag, 80),
      oem_manufacturer:         cs(r.oem_manufacturer, 150),
      oem_model:                cs(r.oem_model, 200),
      oem_spec:                 cs(r.oem_spec, 500),
      oem_part_no:              cs(r.oem_part_no, 150),
      replacement_manufacturer: cs(r.replacement_manufacturer, 150),
      replacement_model:        cs(r.replacement_model, 200),
      replacement_spec:         cs(r.replacement_spec, 500),
      replacement_part_no:      cs(r.replacement_part_no, 150),
      critical_level:           ['critical', 'normal', 'low'].includes(String(r.critical_level || ''))
                                  ? String(r.critical_level) : 'normal',
      status:                   'active',
      note:                     cs(r.note, 1000),
      normalized_search:        buildSearchText([
        r.plant_name, r.unit_no, group, r.equipment_name, r.equipment_tag,
        r.oem_manufacturer, r.oem_model, r.oem_spec, r.oem_part_no,
        r.replacement_manufacturer, r.replacement_model, r.replacement_spec, r.replacement_part_no,
      ]),
      created_by: actor?.id || '',
      created_at: now,
      updated_at: now,
    };
    try {
      await insertClientEquipmentSQL(env.DB, row);
      results.created++;
    } catch (err) {
      results.errors.push(`Dong ${i + 1}: ${err.message || 'loi khi luu'}`);
    }
  }

  if (results.created > 0) {
    ctx.waitUntil(writeActionLog(env, {
      action: 'importClientEquipment',
      entityType: 'client_equipment',
      entityId: clientId,
      newJson: { clientId, created: results.created },
      actor,
    }));
  }

  return json({ ok: true, ...results });
}
