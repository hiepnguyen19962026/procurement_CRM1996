import {
  archiveContractItemSQL,
  archiveContractSQL,
  getContractItemSQL,
  getContractItemsForRfqItemSQL,
  getContractItemsSQL,
  getContractSQL,
  insertContractItemSQL,
  insertContractSQL,
  listContractsSQL,
  recalcContractTotalSQL,
  updateContractItemSQL,
  updateContractSQL,
} from '../db/contract-queries.js';
import { getRfqItemSQL } from '../db/rfq-item-queries.js';
import { getSupplierQuoteSQL } from '../db/supplier-quote-queries.js';
import { getRfqSQL } from '../db/rfq-queries.js';
import { ALL_ROLES, MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanNumber, cleanString } from '../lib/normalize.js';
import { clampLimit, json, makeId, nowIso, readJson } from '../lib/utils.js';

const VALID_CURRENCY = new Set(['VND', 'USD', 'EUR', 'JPY', 'CNY', 'SGD', 'KRW']);
const VALID_STATUS   = new Set(['active', 'archived']);
const DATE_RE        = /^\d{4}-\d{2}-\d{2}$/;

export async function handleContracts(action, request, env, ctx, actor) {
  if (action === 'getContracts')               return listContracts(request, env, actor);
  if (action === 'getContractDetail')          return getDetail(request, env, actor);
  if (action === 'getContractItemsForRfqItem') return getItemsForRfqItem(request, env, actor);
  if (action === 'createContract')             return saveContract(request, env, ctx, actor, false);
  if (action === 'updateContract')             return saveContract(request, env, ctx, actor, true);
  if (action === 'archiveContract')            return archiveContract(request, env, ctx, actor);
  if (action === 'addContractItem')            return addItem(request, env, ctx, actor);
  if (action === 'updateContractItem')         return updateItem(request, env, ctx, actor);
  if (action === 'archiveContractItem')        return archiveItem(request, env, ctx, actor);
  if (action === 'createContractFromRfqItem')  return createFromRfqItem(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown contract action' }, 400);
}

// ─── list ────────────────────────────────────────────────────────────────────

async function listContracts(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const limit = clampLimit(body.limit, 50, 200);

  let cursorSortDate = null;
  let cursorContractId = null;
  const cursorRaw = cleanString(body.cursor || '', 200);
  if (cursorRaw) {
    const parts = cursorRaw.split('|');
    if (parts.length === 2 && parts[0] && parts[1]) {
      cursorSortDate = parts[0];
      cursorContractId = parts[1];
    }
  }

  const rows = await listContractsSQL(env.DB, {
    q:               cleanString(body.q || '', 200),
    rfqId:           cleanString(body.rfqId || body.rfq_id || '', 80),
    clientId:        cleanString(body.clientId || body.client_id || '', 80),
    status:          cleanString(body.status || '', 20),
    dateFrom:        cleanString(body.dateFrom || '', 20),
    dateTo:          cleanString(body.dateTo || '', 20),
    cursorSortDate,
    cursorContractId,
    limit: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  let nextCursor = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = (last.signed_date || last.created_at) + '|' + last.contract_id;
  }
  return json({ ok: true, rows: page, hasMore, nextCursor });
}

// ─── detail ──────────────────────────────────────────────────────────────────

async function getDetail(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const contractId = cleanString(body.contractId || body.contract_id || '', 80);
  if (!contractId) return json({ ok: false, error: 'Thieu ma hop dong' }, 400);
  const contract = await getContractSQL(env.DB, contractId);
  if (!contract) return json({ ok: false, error: 'Khong tim thay hop dong' }, 404);
  const items = await getContractItemsSQL(env.DB, contractId);
  return json({ ok: true, contract, items });
}

// ─── contract items for rfq item (modal section) ─────────────────────────────

async function getItemsForRfqItem(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id || '', 80);
  if (!rfqItemId) return json({ ok: false, error: 'Thieu rfqItemId' }, 400);
  const rows = await getContractItemsForRfqItemSQL(env.DB, rfqItemId);
  return json({ ok: true, rows });
}

// ─── create / update contract ─────────────────────────────────────────────────

async function saveContract(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();

  const oldContract = isUpdate
    ? await getContractSQL(env.DB, cleanString(body.contractId || body.contract_id || '', 80))
    : null;
  if (isUpdate && !oldContract) return json({ ok: false, error: 'Khong tim thay hop dong' }, 404);
  if (isUpdate && oldContract.status === 'archived') {
    return json({ ok: false, error: 'Hop dong da luu tru, khong sua duoc' }, 400);
  }

  const contractNo = cleanString(body.contractNo || body.contract_no || '', 200);
  if (!contractNo) return json({ ok: false, error: 'So hop dong la bat buoc' }, 400);

  // Default client_id from RFQ if provided and not overridden.
  const rfqId = cleanString(body.rfqId || body.rfq_id || oldContract?.rfq_id || '', 80);
  let clientId = cleanString(body.clientId || body.client_id || oldContract?.client_id || '', 80);
  if (rfqId && !clientId) {
    const rfq = await getRfqSQL(env.DB, rfqId);
    clientId = rfq?.client_id || '';
  }

  const rawCurrency = cleanString(body.currency || oldContract?.currency || 'VND', 10).toUpperCase();
  const currency = VALID_CURRENCY.has(rawCurrency) ? rawCurrency : 'VND';

  const contract = {
    contract_id:    isUpdate ? oldContract.contract_id : makeId('CTR'),
    rfq_id:         rfqId || null,
    contract_no:    contractNo,
    contract_name:  cleanString(body.contractName || body.contract_name || oldContract?.contract_name || '', 300),
    client_id:      clientId || null,
    signed_date:    validateDate(body.signedDate || body.signed_date || oldContract?.signed_date || ''),
    effective_date: validateDate(body.effectiveDate || body.effective_date || oldContract?.effective_date || ''),
    expiry_date:    validateDate(body.expiryDate || body.expiry_date || oldContract?.expiry_date || ''),
    currency,
    contract_total: isUpdate ? oldContract.contract_total : 0,
    status:         isUpdate ? (oldContract.status || 'active') : 'active',
    note:           cleanString(body.note || oldContract?.note || '', 2000),
    created_by:     isUpdate ? oldContract.created_by : actor.id,
    created_at:     isUpdate ? oldContract.created_at : now,
    updated_at:     now,
    archived_at:    oldContract?.archived_at || null,
  };

  if (isUpdate) {
    await updateContractSQL(env.DB, contract);
  } else {
    await insertContractSQL(env.DB, contract);

    // Insert items if provided.
    const rawItems = Array.isArray(body.items) ? body.items : [];
    for (const p of rawItems) {
      const ci = await buildContractItem(env.DB, contract.contract_id, p, now);
      if (!ci) continue;
      await insertContractItemSQL(env.DB, ci);
    }

    if (rawItems.length > 0) {
      contract.contract_total = await recalcContractTotalSQL(env.DB, contract.contract_id, now);
    }
  }

  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? 'updateContract' : 'createContract',
    entityType: 'contract',
    entityId: contract.contract_id,
    oldJson: oldContract,
    newJson: contract,
    actor,
  }));
  return json({ ok: true, contract });
}

// ─── archive contract ─────────────────────────────────────────────────────────

async function archiveContract(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const contractId = cleanString(body.contractId || body.contract_id || '', 80);
  if (!contractId) return json({ ok: false, error: 'Thieu ma hop dong' }, 400);
  const old = await getContractSQL(env.DB, contractId);
  if (!old) return json({ ok: false, error: 'Khong tim thay hop dong' }, 404);
  if (old.status === 'archived') return json({ ok: false, error: 'Hop dong da luu tru' }, 400);
  const now = nowIso();
  await archiveContractSQL(env.DB, contractId, now);
  ctx.waitUntil(writeActionLog(env, {
    action: 'archiveContract',
    entityType: 'contract',
    entityId: contractId,
    oldJson: old,
    newJson: { ...old, status: 'archived', archived_at: now, updated_at: now },
    actor,
  }));
  return json({ ok: true });
}

// ─── add contract item ────────────────────────────────────────────────────────

async function addItem(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const contractId = cleanString(body.contractId || body.contract_id || '', 80);
  if (!contractId) return json({ ok: false, error: 'Thieu ma hop dong' }, 400);
  const contract = await getContractSQL(env.DB, contractId);
  if (!contract) return json({ ok: false, error: 'Khong tim thay hop dong' }, 404);
  if (contract.status === 'archived') return json({ ok: false, error: 'Hop dong da luu tru' }, 400);
  const now = nowIso();
  const ci = await buildContractItem(env.DB, contractId, body, now);
  if (!ci) return json({ ok: false, error: 'ten_vat_tu la bat buoc' }, 400);
  await insertContractItemSQL(env.DB, ci);
  const newTotal = await recalcContractTotalSQL(env.DB, contractId, now);
  ctx.waitUntil(writeActionLog(env, {
    action: 'addContractItem',
    entityType: 'contract_item',
    entityId: ci.contract_item_id,
    oldJson: null,
    newJson: ci,
    actor,
  }));
  return json({ ok: true, item: ci, contract_total: newTotal });
}

// ─── update contract item ─────────────────────────────────────────────────────

async function updateItem(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const contractItemId = cleanString(body.contractItemId || body.contract_item_id || '', 80);
  if (!contractItemId) return json({ ok: false, error: 'Thieu ma dong hop dong' }, 400);
  const old = await getContractItemSQL(env.DB, contractItemId);
  if (!old) return json({ ok: false, error: 'Khong tim thay dong hop dong' }, 404);
  if (old.status === 'archived') return json({ ok: false, error: 'Dong hop dong da luu tru' }, 400);
  const tenVatTu = cleanString(body.tenVatTu || body.ten_vat_tu || old.ten_vat_tu, 500);
  if (!tenVatTu) return json({ ok: false, error: 'ten_vat_tu la bat buoc' }, 400);
  const now = nowIso();
  const qty   = cleanNumber(body.contractQuantity  ?? body.contract_quantity  ?? old.contract_quantity);
  const price = Math.round(cleanNumber(body.contractUnitPrice ?? body.contract_unit_price ?? old.contract_unit_price));
  const line  = Math.round(cleanNumber(body.contractLineTotal ?? body.contract_line_total ?? (qty * price))) || Math.round(qty * price);
  const updated = {
    contract_item_id:    contractItemId,
    line_no:             cleanString(body.lineNo || body.line_no || old.line_no || '', 40),
    ma_vat_tu:           cleanString(body.maVatTu || body.ma_vat_tu || old.ma_vat_tu || '', 120),
    ten_vat_tu:          tenVatTu,
    required_model:      cleanString(body.requiredModel || body.required_model || old.required_model || '', 400),
    manufacturer:        cleanString(body.manufacturer || old.manufacturer || '', 180),
    brand:               cleanString(body.brand || old.brand || '', 120),
    origin_country:      cleanString(body.originCountry || body.origin_country || old.origin_country || '', 120),
    unit:                cleanString(body.unit || old.unit || '', 40),
    contract_quantity:   qty,
    contract_unit_price: price,
    contract_line_total: line,
    supplier_id:         cleanString(body.supplierId || body.supplier_id || old.supplier_id || '', 80) || null,
    supplier_name:       cleanString(body.supplierName || body.supplier_name || old.supplier_name || '', 180),
    source_quote_id:     cleanString(body.sourceQuoteId || body.source_quote_id || old.source_quote_id || '', 80) || null,
    note:                cleanString(body.note || old.note || '', 2000),
    updated_at:          now,
  };
  await updateContractItemSQL(env.DB, updated);
  const newTotal = await recalcContractTotalSQL(env.DB, old.contract_id, now);
  ctx.waitUntil(writeActionLog(env, {
    action: 'updateContractItem',
    entityType: 'contract_item',
    entityId: contractItemId,
    oldJson: old,
    newJson: { ...old, ...updated },
    actor,
  }));
  return json({ ok: true, item: { ...old, ...updated }, contract_total: newTotal });
}

// ─── archive contract item ────────────────────────────────────────────────────

async function archiveItem(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const contractItemId = cleanString(body.contractItemId || body.contract_item_id || '', 80);
  if (!contractItemId) return json({ ok: false, error: 'Thieu ma dong hop dong' }, 400);
  const old = await getContractItemSQL(env.DB, contractItemId);
  if (!old) return json({ ok: false, error: 'Khong tim thay dong hop dong' }, 404);
  if (old.status === 'archived') return json({ ok: false, error: 'Dong hop dong da luu tru' }, 400);
  const now = nowIso();
  await archiveContractItemSQL(env.DB, contractItemId, now);
  const newTotal = await recalcContractTotalSQL(env.DB, old.contract_id, now);
  ctx.waitUntil(writeActionLog(env, {
    action: 'archiveContractItem',
    entityType: 'contract_item',
    entityId: contractItemId,
    oldJson: old,
    newJson: { ...old, status: 'archived', archived_at: now, updated_at: now },
    actor,
  }));
  return json({ ok: true, contract_total: newTotal });
}

// ─── create contract from a single rfq item ───────────────────────────────────

async function createFromRfqItem(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();

  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id || '', 80);
  if (!rfqItemId) return json({ ok: false, error: 'Thieu rfqItemId' }, 400);
  const contractNo = cleanString(body.contractNo || body.contract_no || '', 200);
  if (!contractNo) return json({ ok: false, error: 'So hop dong la bat buoc' }, 400);

  const rfqItem = await getRfqItemSQL(env.DB, rfqItemId);
  if (!rfqItem) return json({ ok: false, error: 'Khong tim thay dong vat tu' }, 404);

  // Inherit rfq/client from rfq_item's parent RFQ.
  const rfqId = rfqItem.rfq_id || '';
  let clientId = cleanString(body.clientId || body.client_id || '', 80);
  if (rfqId && !clientId) {
    const rfq = await getRfqSQL(env.DB, rfqId);
    clientId = rfq?.client_id || '';
  }

  const rawCurrency = cleanString(body.currency || 'VND', 10).toUpperCase();
  const currency = VALID_CURRENCY.has(rawCurrency) ? rawCurrency : 'VND';

  const contract = {
    contract_id:   makeId('CTR'),
    rfq_id:        rfqId || null,
    contract_no:   contractNo,
    contract_name: cleanString(body.contractName || body.contract_name || '', 300),
    client_id:     clientId || null,
    signed_date:   validateDate(body.signedDate || body.signed_date || ''),
    effective_date: validateDate(body.effectiveDate || body.effective_date || ''),
    expiry_date:   validateDate(body.expiryDate || body.expiry_date || ''),
    currency,
    contract_total: 0,
    status:        'active',
    note:          cleanString(body.note || '', 2000),
    created_by:    actor.id,
    created_at:    now,
    updated_at:    now,
    archived_at:   null,
  };
  await insertContractSQL(env.DB, contract);

  // Build the one contract item from rfq_item snapshot + optional source_quote.
  const ci = await buildContractItem(env.DB, contract.contract_id, {
    ...body,
    rfqItemId,
    tenVatTu: rfqItem.ten_vat_tu,
  }, now);
  if (ci) {
    await insertContractItemSQL(env.DB, ci);
    contract.contract_total = await recalcContractTotalSQL(env.DB, contract.contract_id, now);
  }

  ctx.waitUntil(writeActionLog(env, {
    action: 'createContractFromRfqItem',
    entityType: 'contract',
    entityId: contract.contract_id,
    oldJson: null,
    newJson: contract,
    actor,
  }));
  return json({ ok: true, contract, item: ci });
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// Build a normalised contract_item row.
// Copies rfq_item snapshot when rfqItemId given.
// Copies supplier/price from source quote when sourceQuoteId given.
// Returns null if ten_vat_tu is empty after all sources.
async function buildContractItem(db, contractId, p, now) {
  // Start with explicit fields from payload.
  let maVatTu    = cleanString(p.maVatTu    || p.ma_vat_tu    || '', 120);
  let tenVatTu   = cleanString(p.tenVatTu   || p.ten_vat_tu   || '', 500);
  let model      = cleanString(p.requiredModel || p.required_model || '', 400);
  let mfr        = cleanString(p.manufacturer  || '', 180);
  let brand      = cleanString(p.brand         || '', 120);
  let origin     = cleanString(p.originCountry || p.origin_country || '', 120);
  let unit       = cleanString(p.unit          || '', 40);
  let itemId     = cleanString(p.itemId     || p.item_id    || '', 80) || null;
  let supplierId = cleanString(p.supplierId || p.supplier_id || '', 80) || null;
  let supplierName = cleanString(p.supplierName || p.supplier_name || '', 180);
  let qty    = cleanNumber(p.contractQuantity  ?? p.contract_quantity  ?? 0);
  let price  = Math.round(cleanNumber(p.contractUnitPrice ?? p.contract_unit_price ?? 0));

  const rfqItemId    = cleanString(p.rfqItemId    || p.rfq_item_id    || '', 80) || null;
  const sourceQuoteId = cleanString(p.sourceQuoteId || p.source_quote_id || '', 80) || null;

  // Snapshot from rfq_item (fills blanks, does not override explicit payload values).
  if (rfqItemId) {
    const ri = await getRfqItemSQL(db, rfqItemId);
    if (ri) {
      if (!maVatTu)  maVatTu = cleanString(ri.ma_vat_tu || '', 120);
      if (!tenVatTu) tenVatTu = cleanString(ri.ten_vat_tu || '', 500);
      if (!model)    model    = cleanString(ri.required_model || ri.quy_cach_model_yeu_cau || '', 400);
      if (!mfr)      mfr      = cleanString(ri.manufacturer  || ri.hang_goc_nsx_goc || '', 180);
      if (!brand)    brand    = cleanString(ri.brand || ri.nhan_hieu || '', 120);
      if (!origin)   origin   = cleanString(ri.origin_country || ri.xuat_xu || '', 120);
      if (!unit)     unit     = cleanString(ri.unit || ri.don_vi || '', 40);
      if (!qty)      qty      = cleanNumber(ri.quantity ?? ri.so_luong ?? 0);
      if (!itemId)   itemId   = ri.item_id || null;
    }
  }

  // Snapshot from source quote (fills supplier + price where missing).
  if (sourceQuoteId) {
    const sq = await getSupplierQuoteSQL(db, sourceQuoteId);
    if (sq) {
      if (!supplierId)   supplierId   = sq.supplier_id || null;
      if (!supplierName) supplierName = cleanString(sq.supplier_name || '', 180);
      if (!mfr)          mfr          = cleanString(sq.manufacturer  || '', 180);
      // Use price_vnd_incl_tax as unit price default when not explicitly set.
      if (!price && sq.price_vnd_incl_tax) price = sq.price_vnd_incl_tax;
    }
  }

  if (!tenVatTu) return null;

  const lineTotal = Math.round(
    cleanNumber(p.contractLineTotal ?? p.contract_line_total ?? (qty * price))
  ) || Math.round(qty * price);

  return {
    contract_item_id:    makeId('CI'),
    contract_id:         contractId,
    rfq_item_id:         rfqItemId,
    item_id:             itemId,
    line_no:             cleanString(p.lineNo || p.line_no || '', 40),
    ma_vat_tu:           maVatTu || null,
    ten_vat_tu:          tenVatTu,
    required_model:      model  || null,
    manufacturer:        mfr    || null,
    brand:               brand  || null,
    origin_country:      origin || null,
    unit:                unit   || null,
    contract_quantity:   qty,
    contract_unit_price: price,
    contract_line_total: lineTotal,
    supplier_id:         supplierId,
    supplier_name:       supplierName || null,
    source_quote_id:     sourceQuoteId,
    status:              'active',
    note:                cleanString(p.note || '', 2000),
    created_at:          now,
    updated_at:          now,
    archived_at:         null,
  };
}

function validateDate(value) {
  const s = cleanString(value || '', 20);
  return DATE_RE.test(s) ? s : '';
}
