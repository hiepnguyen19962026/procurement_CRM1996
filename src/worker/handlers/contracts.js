import {
  archiveContractAddendumItemSQL,
  archiveContractAddendumSQL,
  archiveContractItemSQL,
  archiveContractSQL,
  getContractAddendumItemSQL,
  getContractAddendumItemSummarySQL,
  getContractAddendumItemsSQL,
  getContractAddendumSQL,
  getContractAddendumSummarySQL,
  getContractItemSQL,
  getContractItemsForRfqItemSQL,
  getContractItemsSQL,
  getContractSQL,
  insertContractAddendumItemSQL,
  insertContractAddendumSQL,
  insertContractItemSQL,
  insertContractSQL,
  listContractAddendumsSQL,
  listContractsSQL,
  recalcContractTotalSQL,
  searchContractAddendumItemsSQL,
  updateContractAddendumItemSQL,
  updateContractAddendumSQL,
  updateContractItemSQL,
  updateContractSQL,
} from '../db/contract-queries.js';
import { getRfqItemSQL } from '../db/rfq-item-queries.js';
import { getSupplierQuoteSQL } from '../db/supplier-quote-queries.js';
import { getRfqSQL } from '../db/rfq-queries.js';
import { ALL_ROLES, MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanMoney, cleanNumber, cleanString, normalizeText } from '../lib/normalize.js';
import { clampLimit, json, makeId, nowIso, readJson } from '../lib/utils.js';

const VALID_CURRENCY = new Set(['VND', 'USD', 'EUR', 'JPY', 'CNY', 'SGD', 'KRW']);
const VALID_STATUS   = new Set(['active', 'archived']);
const VALID_ADDENDUM_STATUS = new Set(['draft', 'active', 'archived', 'cancelled']);
const VALID_ADDENDUM_ITEM_TYPE = new Set(['material', 'service', 'other']);
const VALID_DELIVERY_TRIGGER_TYPE = new Set(['contract_sign', 'award_notice', 'delivery_notice', 'po_date', 'manual']);
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
  if (action === 'getContractAddendums')       return listAddendums(request, env, actor);
  if (action === 'createContractAddendum')     return saveAddendum(request, env, ctx, actor, false);
  if (action === 'updateContractAddendum')     return saveAddendum(request, env, ctx, actor, true);
  if (action === 'archiveContractAddendum')    return archiveAddendum(request, env, ctx, actor);
  if (action === 'searchContractAddendumItems') return searchAddendumItems(request, env, actor);
  if (action === 'getContractAddendumItems')   return listAddendumItems(request, env, actor);
  if (action === 'createContractAddendumItem') return saveAddendumItem(request, env, ctx, actor, false);
  if (action === 'updateContractAddendumItem') return saveAddendumItem(request, env, ctx, actor, true);
  if (action === 'archiveContractAddendumItem') return archiveAddendumItem(request, env, ctx, actor);
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
  let rfqRow = null;
  let clientId = cleanString(body.clientId || body.client_id || oldContract?.client_id || '', 80);
  if (rfqId) {
    rfqRow = await getRfqSQL(env.DB, rfqId);
    if (!clientId) clientId = rfqRow?.client_id || '';
  }

  const rawCurrency = cleanString(body.currency || oldContract?.currency || 'VND', 10).toUpperCase();
  const currency = VALID_CURRENCY.has(rawCurrency) ? rawCurrency : 'VND';
  const initialContractTotal = isUpdate ? oldContract.contract_total : Math.max(0, cleanMoney(body.contractTotal ?? body.contract_total ?? 0));

  const contract = {
    contract_id:    isUpdate ? oldContract.contract_id : makeId('CTR'),
    rfq_id:         rfqId || null,
    contract_no:    contractNo,
    contract_name:  cleanString(isUpdate ? (body.contractName || body.contract_name || oldContract?.contract_name || '') : (rfqRow?.ten_goi || body.contractName || body.contract_name || ''), 300),
    client_id:      clientId || null,
    signed_date:    validateDate(body.signedDate || body.signed_date || oldContract?.signed_date || ''),
    effective_date: validateDate(body.effectiveDate || body.effective_date || oldContract?.effective_date || ''),
    expiry_date:    validateDate(body.expiryDate || body.expiry_date || oldContract?.expiry_date || ''),
    currency,
    contract_total: initialContractTotal,
    status:         isUpdate ? (oldContract.status || 'active') : 'active',
    note:           cleanString(body.note || oldContract?.note || '', 2000),
    party_a:        cleanString(body.partyA || body.party_a || oldContract?.party_a || '', 300),
    party_b:        cleanString(body.partyB || body.party_b || oldContract?.party_b || '', 300),
    created_by:     isUpdate ? oldContract.created_by : actor.id,
    created_at:     isUpdate ? oldContract.created_at : now,
    updated_at:     now,
    archived_at:    oldContract?.archived_at || null,
  };

  if (isUpdate) {
    await updateContractSQL(env.DB, contract);
  } else {
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const contractItems = [];
    for (const p of rawItems) {
      const ci = await buildContractItem(env.DB, contract.contract_id, p, now, contract);
      if (!ci) continue;
      if (ci.delivery_error) return json({ ok: false, error: ci.delivery_error }, 400);
      contractItems.push(ci);
    }

    await insertContractSQL(env.DB, contract);

    // Insert items if provided.
    for (const ci of contractItems) {
      await insertContractItemSQL(env.DB, ci);
    }

    if (contractItems.length > 0) {
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
  const ci = await buildContractItem(env.DB, contractId, body, now, contract);
  if (!ci) return json({ ok: false, error: 'ten_vat_tu la bat buoc' }, 400);
  if (ci.delivery_error) return json({ ok: false, error: ci.delivery_error }, 400);
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
  const contract = await getContractSQL(env.DB, old.contract_id);
  const deadline = buildDeliveryDeadlineFields(body, old, contract);
  if (!deadline.ok) return json({ ok: false, error: deadline.error }, 400);
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
    ...deadline.fields,
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

// Addendum headers for a parent contract. Phase 1 keeps line items out of scope.
async function listAddendums(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const contractId = cleanString(body.contractId || body.contract_id || '', 80);
  if (!contractId) return json({ ok: false, error: 'Thieu ma hop dong' }, 400);
  const contract = await getContractSQL(env.DB, contractId);
  if (!contract) return json({ ok: false, error: 'Khong tim thay hop dong' }, 404);
  const rows = await listContractAddendumsSQL(env.DB, contractId);
  const summary = await getContractAddendumSummarySQL(env.DB, contractId);
  return json({ ok: true, contract, rows, summary });
}

async function saveAddendum(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();

  const old = isUpdate
    ? await getContractAddendumSQL(env.DB, cleanString(body.addendumId || body.addendum_id || '', 80))
    : null;
  if (isUpdate && !old) return json({ ok: false, error: 'Khong tim thay phu luc' }, 404);
  if (isUpdate && old.status === 'archived') {
    return json({ ok: false, error: 'Phu luc da luu tru, khong sua duoc' }, 400);
  }

  const contractId = cleanString(body.contractId || body.contract_id || old?.contract_id || '', 80);
  if (!contractId) return json({ ok: false, error: 'Thieu ma hop dong' }, 400);
  const contract = await getContractSQL(env.DB, contractId);
  if (!contract) return json({ ok: false, error: 'Khong tim thay hop dong' }, 404);
  if (contract.status === 'archived') {
    return json({ ok: false, error: 'Hop dong da luu tru, khong them/sua phu luc' }, 400);
  }

  const addendumNo = cleanString(body.addendumNo || body.addendum_no || old?.addendum_no || '', 200);
  if (!addendumNo) return json({ ok: false, error: 'So phu luc la bat buoc' }, 400);

  const valueBeforeTax = signedMoneyValue(body.valueBeforeTax ?? body.value_before_tax ?? old?.value_before_tax);
  const taxRate = nonNegativeNumber(body.taxRate ?? body.tax_rate ?? old?.tax_rate);
  if (!valueBeforeTax.ok) return json({ ok: false, error: 'Gia tri truoc thue khong hop le' }, 400);
  if (!taxRate.ok) return json({ ok: false, error: 'Thue % phai >= 0' }, 400);
  const hasValueAfterTaxPayload = hasOwn(body, 'valueAfterTax') || hasOwn(body, 'value_after_tax');
  const valueAfterTax = hasValueAfterTaxPayload
    ? signedMoneyValue(body.valueAfterTax ?? body.value_after_tax)
    : { ok: true, value: Math.round(valueBeforeTax.value * (1 + taxRate.value / 100)) };
  if (!valueAfterTax.ok) return json({ ok: false, error: 'Gia tri sau thue khong hop le' }, 400);
  const hasAmountDeltaPayload = hasOwn(body, 'amountDelta') || hasOwn(body, 'amount_delta');
  const amountDelta = hasAmountDeltaPayload
    ? signedMoneyValue(body.amountDelta ?? body.amount_delta)
    : { ok: true, value: valueAfterTax.value };
  if (!amountDelta.ok) return json({ ok: false, error: 'Tac dong gia tri khong hop le' }, 400);

  const rawStatus = cleanString(body.status || old?.status || 'active', 20);
  const status = VALID_ADDENDUM_STATUS.has(rawStatus) ? rawStatus : 'active';
  const row = {
    addendum_id:      isUpdate ? old.addendum_id : makeId('ADD'),
    contract_id:      contractId,
    addendum_no:      addendumNo,
    addendum_name:    cleanString(body.addendumName || body.addendum_name || old?.addendum_name || '', 300),
    signed_date:      validateDate(body.signedDate || body.signed_date || old?.signed_date || ''),
    value_before_tax: valueBeforeTax.value,
    tax_rate:         taxRate.value,
    value_after_tax:  valueAfterTax.value,
    amount_delta:     amountDelta.value,
    note:             cleanString(body.note || old?.note || '', 4000),
    external_url:     cleanUrl(body.externalUrl ?? body.external_url ?? old?.external_url ?? ''),
    status,
    created_by:       isUpdate ? old.created_by : actor.id,
    created_at:       isUpdate ? old.created_at : now,
    updated_at:       now,
    archived_at:      old?.archived_at || null,
  };

  if (isUpdate) await updateContractAddendumSQL(env.DB, row);
  else await insertContractAddendumSQL(env.DB, row);

  const summary = await getContractAddendumSummarySQL(env.DB, contractId);
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? 'updateContractAddendum' : 'createContractAddendum',
    entityType: 'contract_addendum',
    entityId: row.addendum_id,
    oldJson: old,
    newJson: row,
    actor,
  }));
  return json({ ok: true, addendum: row, summary });
}

async function archiveAddendum(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const addendumId = cleanString(body.addendumId || body.addendum_id || '', 80);
  if (!addendumId) return json({ ok: false, error: 'Thieu ma phu luc' }, 400);
  const old = await getContractAddendumSQL(env.DB, addendumId);
  if (!old) return json({ ok: false, error: 'Khong tim thay phu luc' }, 404);
  if (old.status === 'archived') return json({ ok: false, error: 'Phu luc da luu tru' }, 400);
  const now = nowIso();
  await archiveContractAddendumSQL(env.DB, addendumId, now);
  const summary = await getContractAddendumSummarySQL(env.DB, old.contract_id);
  ctx.waitUntil(writeActionLog(env, {
    action: 'archiveContractAddendum',
    entityType: 'contract_addendum',
    entityId: addendumId,
    oldJson: old,
    newJson: { ...old, status: 'archived', archived_at: now, updated_at: now },
    actor,
  }));
  return json({ ok: true, summary });
}

async function listAddendumItems(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const addendumId = cleanString(body.addendumId || body.addendum_id || '', 80);
  if (!addendumId) return json({ ok: false, error: 'Thieu ma phu luc' }, 400);
  const addendum = await getContractAddendumSQL(env.DB, addendumId);
  if (!addendum) return json({ ok: false, error: 'Khong tim thay phu luc' }, 404);
  const rows = await getContractAddendumItemsSQL(env.DB, addendumId);
  const summary = await getContractAddendumItemSummarySQL(env.DB, addendumId);
  return json({ ok: true, addendum, rows, summary });
}

async function searchAddendumItems(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const q = normalizeText(cleanString(body.q || '', 200));
  const q2 = normalizeText(cleanString(body.q2 || '', 200));
  const q3 = normalizeText(cleanString(body.q3 || '', 200));
  if (!q && !q2 && !q3) return json({ ok: true, rows: [] });
  const rows = await searchContractAddendumItemsSQL(env.DB, {
    q,
    q2,
    q3,
    rfqId: cleanString(body.rfqId || body.rfq_id || '', 80),
    limit: clampLimit(body.limit, 50, 100),
  });
  return json({ ok: true, rows });
}

async function saveAddendumItem(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();

  const old = isUpdate
    ? await getContractAddendumItemSQL(env.DB, cleanString(body.addendumItemId || body.addendum_item_id || '', 80))
    : null;
  if (isUpdate && !old) return json({ ok: false, error: 'Khong tim thay dong chi tiet phu luc' }, 404);
  if (isUpdate && old.status === 'archived') {
    return json({ ok: false, error: 'Dong chi tiet da luu tru, khong sua duoc' }, 400);
  }

  const addendumId = cleanString(body.addendumId || body.addendum_id || old?.addendum_id || '', 80);
  if (!addendumId) return json({ ok: false, error: 'Thieu ma phu luc' }, 400);
  const addendum = await getContractAddendumSQL(env.DB, addendumId);
  if (!addendum) return json({ ok: false, error: 'Khong tim thay phu luc' }, 404);
  if (addendum.status === 'archived' || addendum.status === 'cancelled') {
    return json({ ok: false, error: 'Phu luc da luu tru/huy, khong sua chi tiet' }, 400);
  }

  const contract = await getContractSQL(env.DB, addendum.contract_id);
  if (!contract) return json({ ok: false, error: 'Khong tim thay hop dong' }, 404);
  if (contract.status === 'archived') {
    return json({ ok: false, error: 'Hop dong da luu tru, khong sua chi tiet phu luc' }, 400);
  }

  const itemType = cleanString(body.itemType || body.item_type || old?.item_type || 'material', 20);
  if (!VALID_ADDENDUM_ITEM_TYPE.has(itemType)) {
    return json({ ok: false, error: 'Loai dong chi tiet khong hop le' }, 400);
  }

  const itemName = cleanString(body.itemName || body.item_name || old?.item_name || '', 500);
  if (!itemName) return json({ ok: false, error: 'Noi dung la bat buoc' }, 400);

  const qty = nonNegativeNumber(body.quantity ?? old?.quantity ?? 0);
  const unitPrice = nonNegativeMoney(body.unitPrice ?? body.unit_price ?? old?.unit_price ?? 0);
  if (!qty.ok) return json({ ok: false, error: 'So luong phai >= 0' }, 400);
  if (!unitPrice.ok) return json({ ok: false, error: 'Don gia phai >= 0' }, 400);
  const taxRate = nonNegativeNumber(body.taxRate ?? body.tax_rate ?? old?.tax_rate ?? 0);
  if (!taxRate.ok) return json({ ok: false, error: 'Thue % phai >= 0' }, 400);
  const lineTotal = Math.round(qty.value * unitPrice.value * (1 + taxRate.value / 100));

  const row = {
    addendum_item_id: isUpdate ? old.addendum_item_id : makeId('ADI'),
    addendum_id:      addendumId,
    contract_id:      addendum.contract_id,
    rfq_item_id:      cleanString(body.rfqItemId || body.rfq_item_id || old?.rfq_item_id || '', 80) || null,
    item_type:        itemType,
    item_code:        cleanString(body.itemCode || body.item_code || old?.item_code || '', 120),
    item_name:        itemName,
    spec:             cleanString(body.spec || old?.spec || '', 1000),
    unit:             cleanString(body.unit || old?.unit || '', 80),
    quantity:         qty.value,
    unit_price:       unitPrice.value,
    line_total:       lineTotal,
    tax_rate:         taxRate.value,
    note:             cleanString(body.note || old?.note || '', 2000),
    status:           isUpdate ? old.status : 'active',
    created_by:       isUpdate ? old.created_by : actor.id,
    created_at:       isUpdate ? old.created_at : now,
    updated_at:       now,
    archived_at:      old?.archived_at || null,
  };

  if (isUpdate) await updateContractAddendumItemSQL(env.DB, row);
  else await insertContractAddendumItemSQL(env.DB, row);

  const summary = await getContractAddendumItemSummarySQL(env.DB, addendumId);
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? 'updateContractAddendumItem' : 'createContractAddendumItem',
    entityType: 'contract_addendum_item',
    entityId: row.addendum_item_id,
    oldJson: old,
    newJson: row,
    actor,
  }));
  return json({ ok: true, item: row, summary });
}

async function archiveAddendumItem(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const addendumItemId = cleanString(body.addendumItemId || body.addendum_item_id || '', 80);
  if (!addendumItemId) return json({ ok: false, error: 'Thieu ma dong chi tiet phu luc' }, 400);
  const old = await getContractAddendumItemSQL(env.DB, addendumItemId);
  if (!old) return json({ ok: false, error: 'Khong tim thay dong chi tiet phu luc' }, 404);
  if (old.status === 'archived') return json({ ok: false, error: 'Dong chi tiet da luu tru' }, 400);

  const addendum = await getContractAddendumSQL(env.DB, old.addendum_id);
  if (!addendum) return json({ ok: false, error: 'Khong tim thay phu luc' }, 404);
  if (addendum.status === 'archived' || addendum.status === 'cancelled') {
    return json({ ok: false, error: 'Phu luc da luu tru/huy, khong sua chi tiet' }, 400);
  }

  const contract = await getContractSQL(env.DB, old.contract_id);
  if (!contract) return json({ ok: false, error: 'Khong tim thay hop dong' }, 404);
  if (contract.status === 'archived') {
    return json({ ok: false, error: 'Hop dong da luu tru, khong sua chi tiet phu luc' }, 400);
  }

  const now = nowIso();
  await archiveContractAddendumItemSQL(env.DB, addendumItemId, now);
  const summary = await getContractAddendumItemSummarySQL(env.DB, old.addendum_id);
  ctx.waitUntil(writeActionLog(env, {
    action: 'archiveContractAddendumItem',
    entityType: 'contract_addendum_item',
    entityId: addendumItemId,
    oldJson: old,
    newJson: { ...old, status: 'archived', archived_at: now, updated_at: now },
    actor,
  }));
  return json({ ok: true, summary });
}

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

  // Build the one contract item from rfq_item snapshot + optional source_quote.
  const ci = await buildContractItem(env.DB, contract.contract_id, {
    ...body,
    rfqItemId,
    tenVatTu: rfqItem.ten_vat_tu,
  }, now, contract);
  if (ci?.delivery_error) return json({ ok: false, error: ci.delivery_error }, 400);

  await insertContractSQL(env.DB, contract);
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
async function buildContractItem(db, contractId, p, now, contract = null) {
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
  const deadline = buildDeliveryDeadlineFields(p, null, contract);
  if (!deadline.ok) return { delivery_error: deadline.error };

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
    ...deadline.fields,
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

function cleanUrl(raw) {
  const s = cleanString(raw || '', 2000);
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : '';
}

function nonNegativeMoney(value) {
  const n = cleanMoney(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? { ok: true, value: n } : { ok: false, value: 0 };
}

function signedMoneyValue(value) {
  const n = cleanMoney(value ?? 0);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, value: 0 };
}

function nonNegativeNumber(value) {
  const n = cleanNumber(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? { ok: true, value: n } : { ok: false, value: 0 };
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function pickPayloadValue(obj, keys) {
  for (const key of keys) {
    if (hasOwn(obj, key)) return { present: true, value: obj[key] };
  }
  return { present: false, value: undefined };
}

function optionalDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const s = cleanString(value, 20);
  if (!s) return { ok: true, value: null };
  if (!DATE_RE.test(s)) return { ok: false, error: `${fieldName} khong hop le` };
  return { ok: true, value: s };
}

function optionalLeadDays(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const raw = String(value).trim();
  if (!raw) return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, error: 'So ngay giao hang phai la so nguyen >= 0' };
  }
  return { ok: true, value: n };
}

function addDaysYmd(dateStr, days) {
  if (!DATE_RE.test(String(dateStr || '')) || days === null || days === undefined) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

function buildDeliveryDeadlineFields(payload, oldItem = null, contract = null) {
  const leadRaw = pickPayloadValue(payload, ['deliveryLeadDays', 'delivery_lead_days']);
  const typeRaw = pickPayloadValue(payload, ['deliveryTriggerType', 'delivery_trigger_type']);
  const triggerDateRaw = pickPayloadValue(payload, ['deliveryTriggerDate', 'delivery_trigger_date']);
  const deadlineDateRaw = pickPayloadValue(payload, ['deliveryDeadlineDate', 'delivery_deadline_date']);
  const hasDeadlinePayload = leadRaw.present || typeRaw.present || triggerDateRaw.present || deadlineDateRaw.present;

  if (!hasDeadlinePayload && oldItem) {
    return {
      ok: true,
      fields: {
        delivery_lead_days: oldItem.delivery_lead_days ?? null,
        delivery_trigger_type: oldItem.delivery_trigger_type || null,
        delivery_trigger_date: oldItem.delivery_trigger_date || null,
        delivery_deadline_date: oldItem.delivery_deadline_date || null,
      },
    };
  }

  const lead = leadRaw.present ? optionalLeadDays(leadRaw.value) : { ok: true, value: oldItem?.delivery_lead_days ?? null };
  if (!lead.ok) return lead;

  const triggerType = typeRaw.present
    ? cleanString(typeRaw.value || '', 40) || null
    : (oldItem?.delivery_trigger_type || null);
  if (triggerType && !VALID_DELIVERY_TRIGGER_TYPE.has(triggerType)) {
    return { ok: false, error: 'Loai moc tinh deadline giao hang khong hop le' };
  }

  const triggerDate = triggerDateRaw.present
    ? optionalDate(triggerDateRaw.value, 'Ngay moc tinh deadline giao hang')
    : { ok: true, value: oldItem?.delivery_trigger_date || null };
  if (!triggerDate.ok) return triggerDate;

  const directDeadline = deadlineDateRaw.present
    ? optionalDate(deadlineDateRaw.value, 'Ngay deadline giao hang')
    : { ok: true, value: oldItem?.delivery_deadline_date || null };
  if (!directDeadline.ok) return directDeadline;

  let deadlineDate = directDeadline.value || null;
  const leadDays = lead.value;
  const baseTriggerDate = triggerDate.value || null;

  if (triggerType === 'contract_sign') {
    const baseDate = baseTriggerDate || validateDate(contract?.signed_date || '');
    deadlineDate = baseDate && leadDays !== null ? addDaysYmd(baseDate, leadDays) : null;
  } else if (triggerType === 'award_notice' || triggerType === 'delivery_notice' || triggerType === 'po_date') {
    deadlineDate = baseTriggerDate && leadDays !== null ? addDaysYmd(baseTriggerDate, leadDays) : null;
  } else if (triggerType === 'manual') {
    if (!deadlineDate && baseTriggerDate && leadDays !== null) {
      deadlineDate = addDaysYmd(baseTriggerDate, leadDays);
    }
  }

  return {
    ok: true,
    fields: {
      delivery_lead_days: leadDays,
      delivery_trigger_type: triggerType,
      delivery_trigger_date: baseTriggerDate,
      delivery_deadline_date: deadlineDate,
    },
  };
}
