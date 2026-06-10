import { getSupplierSQL, insertSupplierSQL, listSuppliersSQL, updateSupplierSQL } from '../db/supplier-queries.js';
import { ALL_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { buildSearchText, cleanString, normalizeText } from '../lib/normalize.js';
import { clampLimit, json, nextEntityId, nowIso, readJson } from '../lib/utils.js';

export async function handleSuppliers(action, request, env, ctx, actor) {
  if (action === 'getSuppliers') return listSuppliers(request, env, actor);
  if (action === 'createSupplier') return saveSupplier(request, env, ctx, actor, false);
  if (action === 'updateSupplier') return saveSupplier(request, env, ctx, actor, true);
  return json({ ok: false, error: 'Unknown supplier action' }, 400);
}

async function listSuppliers(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const data = await listSuppliersSQL(env.DB, { q: normalizeText(p.q), cursor: p.cursor || '', limit: clampLimit(p.limit) });
  return json({ ok: true, ...data });
}

async function saveSupplier(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const name = cleanString(body.supplierName || body.supplier_name, 180);
  if (!name) return json({ ok: false, error: 'Ten nha cung cap la bat buoc' }, 400);
  const now = nowIso();
  const oldRow = isUpdate ? await getSupplierSQL(env.DB, body.supplierId || body.supplier_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: 'Khong tim thay supplier' }, 404);
  const row = {
    supplier_id: isUpdate ? oldRow.supplier_id : await nextEntityId(env.DB, 'suppliers', 'supplier_id', 'SUP'),
    supplier_name: name,
    supplier_type: cleanString(body.supplierType || body.supplier_type || 'unknown', 40),
    country: cleanString(body.country, 80),
    contact_name: cleanString(body.contactName || body.contact_name, 120),
    email: cleanString(body.email, 160),
    phone: cleanString(body.phone, 60),
    zalo: cleanString(body.zalo, 80),
    wechat: cleanString(body.wechat, 80),
    note: cleanString(body.note, 1000),
    normalized_search: buildSearchText([name, body.country, body.contactName, body.phone, body.email]),
    created_at: oldRow?.created_at || now,
    updated_at: now,
  };
  if (isUpdate) await updateSupplierSQL(env.DB, row);
  else await insertSupplierSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, { action: isUpdate ? 'updateSupplier' : 'createSupplier', entityType: 'supplier', entityId: row.supplier_id, oldJson: oldRow, newJson: row, actor }));
  return json({ ok: true, supplier: row });
}
