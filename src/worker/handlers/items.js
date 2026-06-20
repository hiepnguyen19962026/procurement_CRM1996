import {
  getItemDetailSQL,
  getItemSQL,
  insertItemSQL,
  linkRfqItemToItemSQL,
  searchItemsSQL,
  suggestItemsSQL,
  unlinkRfqItemFromItemSQL,
  updateItemSQL,
} from '../db/item-queries.js';
import { getRfqItemSQL } from '../db/rfq-item-queries.js';
import { ALL_ROLES, MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { buildSearchText, cleanString, normalizeText } from '../lib/normalize.js';
import { clampLimit, json, nextEntityId, nowIso, readJson } from '../lib/utils.js';

const VALID_ITEM_STATUS = new Set(['active', 'inactive']);

export async function handleItems(action, request, env, ctx, actor) {
  if (action === 'searchMasterItems') return searchMasterItems(request, env, actor);
  if (action === 'getMasterItemDetail') return getMasterItemDetail(request, env, actor);
  if (action === 'suggestMasterItemsForRfqItem') return suggestMasterItemsForRfqItem(request, env, actor);
  if (action === 'createMasterItem') return createMasterItem(request, env, ctx, actor);
  if (action === 'updateMasterItem') return updateMasterItem(request, env, ctx, actor);
  if (action === 'linkRfqItemToMaster') return linkRfqItemToMaster(request, env, ctx, actor);
  if (action === 'unlinkRfqItemFromMaster') return unlinkRfqItemFromMaster(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown item action' }, 400);
}

async function searchMasterItems(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const cursor = cleanString(body.cursor || '', 160);
  const parts = cursor ? cursor.split('|') : [];
  const status = normalizeStatus(body.status || 'active', true);
  if (status === null) return json({ ok: false, error: 'status khong hop le' }, 400);
  const limit = clampLimit(body.limit, 50, 100);
  const rowsAll = await searchItemsSQL(env.DB, {
    q: normalizeText(body.q || ''),
    maVatTu: cleanString(body.maVatTu ?? body.ma_vat_tu, 120),
    status,
    cursorUpdatedAt: parts.length === 2 ? parts[0] : '',
    cursorItemId: parts.length === 2 ? parts[1] : '',
    limit: limit + 1,
  });
  const hasMore = rowsAll.length > limit;
  const rows = hasMore ? rowsAll.slice(0, limit) : rowsAll;
  const last = rows[rows.length - 1];
  return json({
    ok: true,
    rows,
    hasMore,
    nextCursor: hasMore && last ? `${last.updated_at}|${last.item_id}` : '',
  });
}

async function getMasterItemDetail(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const itemId = cleanString(body.itemId ?? body.item_id, 80);
  if (!itemId) return json({ ok: false, error: 'Thieu ma master item' }, 400);
  const item = await getItemDetailSQL(env.DB, itemId);
  if (!item) return json({ ok: false, error: 'Khong tim thay master item' }, 404);
  return json({ ok: true, item });
}

async function suggestMasterItemsForRfqItem(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId ?? body.rfq_item_id, 80);
  if (!rfqItemId) return json({ ok: false, error: 'Thieu ma dong vat tu' }, 400);
  const rfqItem = await getRfqItemSQL(env.DB, rfqItemId);
  if (!rfqItem) return json({ ok: false, error: 'Khong tim thay dong vat tu' }, 404);
  try {
    const rows = await suggestItemsSQL(env.DB, suggestionParamsFromRfqItem(rfqItem));
    return json({ ok: true, rows });
  } catch (err) {
    const message = `${err?.message || ''} ${err?.cause?.message || ''}`;
    if (/LIKE or GLOB pattern too complex/i.test(message)) {
      return json({ ok: true, rows: [], warning: 'Du lieu goi y qua phuc tap, da bo qua an toan' });
    }
    throw err;
  }
}

async function createMasterItem(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();
  const sourceRfqItemId = cleanString(body.sourceRfqItemId ?? body.source_rfq_item_id, 80);
  const sourceItem = sourceRfqItemId ? await getRfqItemSQL(env.DB, sourceRfqItemId) : null;
  if (sourceRfqItemId && !sourceItem) return json({ ok: false, error: 'Khong tim thay dong vat tu nguon' }, 404);

  const row = normalizeItemRow(body, sourceItem, {
    item_id: await nextEntityId(env.DB, 'items', 'item_id', 'ITM'),
    status: 'active',
    created_by: actor.id,
    created_at: now,
    updated_at: now,
  });
  if (!row.ten_vat_tu) return json({ ok: false, error: 'Ten master item la bat buoc' }, 400);

  await insertItemSQL(env.DB, row);
  let linkedItem = null;
  if (sourceItem) {
    await linkRfqItemToItemSQL(env.DB, sourceItem.rfq_item_id, row.item_id, now);
    linkedItem = { ...sourceItem, item_id: row.item_id, updated_at: now };
  }

  ctx.waitUntil(writeActionLog(env, {
    action: 'createMasterItem',
    entityType: 'item',
    entityId: row.item_id,
    oldJson: null,
    newJson: { item: row, linkedRfqItem: linkedItem },
    actor,
  }));
  return json({ ok: true, item: row, linkedRfqItem: linkedItem });
}

async function updateMasterItem(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const itemId = cleanString(body.itemId ?? body.item_id, 80);
  if (!itemId) return json({ ok: false, error: 'Thieu ma master item' }, 400);
  const oldRow = await getItemSQL(env.DB, itemId);
  if (!oldRow) return json({ ok: false, error: 'Khong tim thay master item' }, 404);
  const status = normalizeStatus(body.status ?? oldRow.status, false);
  if (status === null) return json({ ok: false, error: 'status khong hop le' }, 400);
  const row = normalizeItemRow(body, oldRow, {
    item_id: oldRow.item_id,
    status,
    created_by: oldRow.created_by,
    created_at: oldRow.created_at,
    updated_at: nowIso(),
  });
  if (!row.ten_vat_tu) return json({ ok: false, error: 'Ten master item la bat buoc' }, 400);
  await updateItemSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: 'updateMasterItem',
    entityType: 'item',
    entityId: row.item_id,
    oldJson: oldRow,
    newJson: row,
    actor,
  }));
  return json({ ok: true, item: row });
}

async function linkRfqItemToMaster(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId ?? body.rfq_item_id, 80);
  const itemId = cleanString(body.itemId ?? body.item_id, 80);
  if (!rfqItemId || !itemId) return json({ ok: false, error: 'Thieu ma dong vat tu hoac master item' }, 400);
  const oldRfqItem = await getRfqItemSQL(env.DB, rfqItemId);
  if (!oldRfqItem) return json({ ok: false, error: 'Khong tim thay dong vat tu' }, 404);
  const item = await getItemSQL(env.DB, itemId);
  if (!item || item.status !== 'active') return json({ ok: false, error: 'Khong tim thay master item active' }, 404);
  const now = nowIso();
  await linkRfqItemToItemSQL(env.DB, rfqItemId, itemId, now);
  const newRfqItem = { ...oldRfqItem, item_id: itemId, updated_at: now };
  ctx.waitUntil(writeActionLog(env, {
    action: 'linkRfqItemToMaster',
    entityType: 'rfq_item',
    entityId: rfqItemId,
    oldJson: oldRfqItem,
    newJson: newRfqItem,
    actor,
  }));
  return json({ ok: true, item, rfqItem: newRfqItem });
}

async function unlinkRfqItemFromMaster(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId ?? body.rfq_item_id, 80);
  if (!rfqItemId) return json({ ok: false, error: 'Thieu ma dong vat tu' }, 400);
  const oldRfqItem = await getRfqItemSQL(env.DB, rfqItemId);
  if (!oldRfqItem) return json({ ok: false, error: 'Khong tim thay dong vat tu' }, 404);
  const now = nowIso();
  await unlinkRfqItemFromItemSQL(env.DB, rfqItemId, now);
  const newRfqItem = { ...oldRfqItem, item_id: null, updated_at: now };
  ctx.waitUntil(writeActionLog(env, {
    action: 'unlinkRfqItemFromMaster',
    entityType: 'rfq_item',
    entityId: rfqItemId,
    oldJson: oldRfqItem,
    newJson: newRfqItem,
    actor,
  }));
  return json({ ok: true, rfqItem: newRfqItem });
}

function normalizeItemRow(body, fallback, base) {
  const row = {
    ...base,
    ma_vat_tu: firstText(body, fallback, ['maVatTu', 'ma_vat_tu'], 'ma_vat_tu', 120),
    ten_vat_tu: firstText(body, fallback, ['tenVatTu', 'ten_vat_tu'], 'ten_vat_tu', 500),
    required_model: firstText(body, fallback, ['requiredModel', 'required_model'], 'required_model', 1000),
    manufacturer: firstText(body, fallback, ['manufacturer'], 'manufacturer', 180),
    brand: firstText(body, fallback, ['brand'], 'brand', 120),
    origin_country: firstText(body, fallback, ['originCountry', 'origin_country'], 'origin_country', 120),
    unit: firstText(body, fallback, ['unit'], 'unit', 80),
    technical_params: firstText(body, fallback, ['technicalParams', 'technical_params'], 'technical_params', 2000),
    note: firstText(body, fallback, ['note'], 'note', 2000),
  };
  row.normalized_search = buildSearchText([
    row.ma_vat_tu, row.ten_vat_tu, row.required_model, row.manufacturer,
    row.brand, row.origin_country, row.unit, row.technical_params,
  ]);
  return row;
}

function firstText(body, fallback, bodyKeys, fallbackKey, max) {
  for (const key of bodyKeys) {
    if (body[key] !== undefined && body[key] !== null) return cleanString(body[key], max);
  }
  return cleanString(fallback?.[fallbackKey], max);
}

function normalizeStatus(value, allowEmpty) {
  const status = cleanString(value || '', 20).toLowerCase();
  if (!status && allowEmpty) return '';
  return VALID_ITEM_STATUS.has(status) ? status : null;
}

function suggestionParamsFromRfqItem(row) {
  const name = cleanString(row.ten_vat_tu, 180);
  const model = cleanString(row.required_model || row.quy_cach_model_yeu_cau, 180);
  const manufacturer = cleanString(row.manufacturer || row.hang_goc_nsx_goc, 120);
  const brand = cleanString(row.brand || row.nhan_hieu, 120);
  const origin = cleanString(row.origin_country || row.xuat_xu, 120);
  const unit = cleanString(row.unit || row.don_vi, 80);
  return {
    maVatTu: cleanString(row.ma_vat_tu, 120),
    tokens: safeSuggestionTokens([
      row.ma_vat_tu, name, model, manufacturer, brand, origin, unit,
    ]),
    unitLike: normalizeText(unit).length >= 2 ? cleanString(unit, 60) : '',
    limit: 10,
  };
}

function safeSuggestionTokens(fields) {
  const tokens = [];
  const seen = new Set();
  for (const field of fields) {
    const parts = normalizeText(field).split(/[^a-z0-9]+/);
    for (const part of parts) {
      const token = part.slice(0, 60);
      if (token.length < 2 || seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
      if (tokens.length >= 8) return tokens;
    }
  }
  return tokens;
}
