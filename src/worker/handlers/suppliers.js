import { archiveSupplierSQL, getSupplierSQL, insertSupplierSQL, listSuppliersSQL, updateSupplierSQL } from '../db/supplier-queries.js';
import { ALL_ROLES, MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { buildSearchText, cleanString, normalizeText } from '../lib/normalize.js';
import { clampLimit, json, nextEntityId, nowIso, readJson } from '../lib/utils.js';

export async function handleSuppliers(action, request, env, ctx, actor) {
  if (action === 'getSuppliers') return listSuppliers(request, env, actor);
  if (action === 'createSupplier') return saveSupplier(request, env, ctx, actor, false);
  if (action === 'updateSupplier') return saveSupplier(request, env, ctx, actor, true);
  if (action === 'archiveSupplier') return archiveSupplier(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown supplier action' }, 400);
}

async function listSuppliers(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const data = await listSuppliersSQL(env.DB, { q: normalizeText(p.q), cursor: p.cursor || '', sortBy: p.sortBy || '', sortDir: p.sortDir || '', limit: clampLimit(p.limit) });
  return json({ ok: true, ...data });
}

async function archiveSupplier(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const supplierId = cleanString(body.supplierId || body.supplier_id, 80);
  if (!supplierId) return json({ ok: false, error: 'Thieu ma nha cung cap' }, 400);
  const row = await getSupplierSQL(env.DB, supplierId);
  if (!row) return json({ ok: false, error: 'Khong tim thay nha cung cap' }, 404);
  const now = nowIso();
  await archiveSupplierSQL(env.DB, supplierId, now);
  ctx.waitUntil(writeActionLog(env, { action: 'archiveSupplier', entityType: 'supplier', entityId: supplierId, oldJson: row, newJson: null, actor }));
  return json({ ok: true });
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
    tax_code: cleanString(body.taxCode || body.tax_code, 80),
    contact_name: cleanString(body.contactName || body.contact_name, 120),
    email: cleanString(body.email, 160),
    phone: cleanString(body.phone, 60),
    zalo: cleanString(body.zalo, 80),
    wechat: cleanString(body.wechat, 80),
    note: cleanString(body.note, 1000),
    normalized_search: buildSearchText([name, body.taxCode || body.tax_code, body.country, body.contactName, body.phone, body.email]),
    created_at: oldRow?.created_at || now,
    updated_at: now,
  };
  if (isUpdate) await updateSupplierSQL(env.DB, row);
  else await insertSupplierSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, { action: isUpdate ? 'updateSupplier' : 'createSupplier', entityType: 'supplier', entityId: row.supplier_id, oldJson: oldRow, newJson: row, actor }));
  return json({ ok: true, supplier: row });
}
