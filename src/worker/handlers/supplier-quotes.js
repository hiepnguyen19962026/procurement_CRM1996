import {
  archiveSupplierQuoteSQL,
  getSupplierQuoteSQL,
  insertSupplierQuoteSQL,
  listSupplierQuotesSQL,
  searchSupplierQuotesSQL,
  updateSupplierQuoteSQL,
} from '../db/supplier-quote-queries.js';
import { getRfqItemSQL } from '../db/rfq-item-queries.js';
import { ALL_ROLES, MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanNumber, cleanString } from '../lib/normalize.js';
import { json, makeId, nowIso, readJson } from '../lib/utils.js';

const VALID_CURRENCY = new Set(['VND', 'USD', 'EUR', 'JPY', 'CNY', 'SGD', 'KRW']);

export async function handleSupplierQuotes(action, request, env, ctx, actor) {
  if (action === 'getSupplierQuotes')    return listQuotes(request, env, actor);
  if (action === 'searchSupplierQuotes') return searchQuotes(request, env, actor);
  if (action === 'createSupplierQuote')  return saveQuote(request, env, ctx, actor, false);
  if (action === 'updateSupplierQuote')  return saveQuote(request, env, ctx, actor, true);
  if (action === 'archiveSupplierQuote') return archiveQuote(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown supplier quote action' }, 400);
}

async function listQuotes(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id, 80);
  if (!rfqItemId) return json({ ok: false, error: 'Thieu ma dong vat tu' }, 400);
  const rows = await listSupplierQuotesSQL(env.DB, rfqItemId);
  return json({ ok: true, rows });
}

async function searchQuotes(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);

  const rawLimit = cleanNumber(body.limit);
  const limit = rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50;

  const status = cleanString(body.status || '', 20);
  if (status && status !== 'active' && status !== 'archived') {
    return json({ ok: false, error: 'status phai la active, archived, hoac de trong' }, 400);
  }

  const validUntilFrom = cleanString(body.validUntilFrom || '', 20);
  const validUntilTo   = cleanString(body.validUntilTo   || '', 20);
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (validUntilFrom && !dateRe.test(validUntilFrom)) {
    return json({ ok: false, error: 'validUntilFrom phai la YYYY-MM-DD' }, 400);
  }
  if (validUntilTo && !dateRe.test(validUntilTo)) {
    return json({ ok: false, error: 'validUntilTo phai la YYYY-MM-DD' }, 400);
  }

  const priceMinRaw = body.priceMin !== undefined && body.priceMin !== '' ? cleanNumber(body.priceMin) : null;
  const priceMaxRaw = body.priceMax !== undefined && body.priceMax !== '' ? cleanNumber(body.priceMax) : null;

  let cursorCreatedAt = null;
  let cursorQuoteId   = null;
  const cursorRaw = cleanString(body.cursor || '', 120);
  if (cursorRaw) {
    const parts = cursorRaw.split('|');
    if (parts.length === 2 && parts[0] && parts[1]) {
      cursorCreatedAt = parts[0];
      cursorQuoteId   = parts[1];
    }
  }

  const params = {
    q:              cleanString(body.q            || '', 200),
    supplierName:   cleanString(body.supplierName || '', 180),
    manufacturer:   cleanString(body.manufacturer || '', 180),
    status,
    priceMin:       priceMinRaw,
    priceMax:       priceMaxRaw,
    validUntilFrom,
    validUntilTo,
    rfqId:          cleanString(body.rfqId     || '', 80),
    rfqItemId:      cleanString(body.rfqItemId || '', 80),
    cursorCreatedAt,
    cursorQuoteId,
    limit: limit + 1,
  };

  const all = await searchSupplierQuotesSQL(env.DB, params);
  const hasMore = all.length > limit;
  const rows = hasMore ? all.slice(0, limit) : all;
  let nextCursor = null;
  if (hasMore && rows.length > 0) {
    const last = rows[rows.length - 1];
    nextCursor = last.created_at + '|' + last.quote_id;
  }
  return json({ ok: true, rows, hasMore, nextCursor });
}

async function saveQuote(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, isUpdate ? MANAGE_ROLES : WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();

  const quoteId = isUpdate ? cleanString(body.quoteId || body.quote_id, 80) : null;
  const oldRow = isUpdate ? await getSupplierQuoteSQL(env.DB, quoteId) : null;
  if (isUpdate && (!oldRow || oldRow.status !== 'active')) {
    return json({ ok: false, error: 'Khong tim thay bao gia hoac da luu tru' }, 404);
  }

  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id || (oldRow && oldRow.rfq_item_id) || '', 80);
  const item = await getRfqItemSQL(env.DB, rfqItemId);
  if (!item) return json({ ok: false, error: 'Khong tim thay dong vat tu' }, 404);

  const row = normalizeQuote(body, {
    quote_id: isUpdate ? oldRow.quote_id : makeId('QUO'),
    rfq_item_id: rfqItemId,
    status: 'active',
    created_by: isUpdate ? oldRow.created_by : actor.id,
    created_at: isUpdate ? oldRow.created_at : now,
    updated_at: isUpdate ? now : null,
  });

  if (isUpdate) await updateSupplierQuoteSQL(env.DB, row);
  else await insertSupplierQuoteSQL(env.DB, row);

  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? 'updateSupplierQuote' : 'createSupplierQuote',
    entityType: 'supplier_quote',
    entityId: row.quote_id,
    oldJson: oldRow,
    newJson: row,
    actor,
  }));
  return json({ ok: true, quote: row });
}

async function archiveQuote(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const quoteId = cleanString(body.quoteId || body.quote_id, 80);
  if (!quoteId) return json({ ok: false, error: 'Thieu ma bao gia' }, 400);
  const oldRow = await getSupplierQuoteSQL(env.DB, quoteId);
  if (!oldRow || oldRow.status !== 'active') {
    return json({ ok: false, error: 'Khong tim thay bao gia hoac da luu tru' }, 404);
  }
  const now = nowIso();
  await archiveSupplierQuoteSQL(env.DB, { quoteId, updatedAt: now });
  ctx.waitUntil(writeActionLog(env, {
    action: 'archiveSupplierQuote',
    entityType: 'supplier_quote',
    entityId: quoteId,
    oldJson: oldRow,
    newJson: { ...oldRow, status: 'archived', updated_at: now },
    actor,
  }));
  return json({ ok: true });
}

function normalizeQuote(body, base) {
  const quotedPrice = cleanNumber(body.quotedPrice ?? body.quoted_price);
  const exchangeRate = cleanNumber(body.exchangeRate ?? body.exchange_rate) || 1;
  const taxRate = cleanNumber(body.taxRate ?? body.tax_rate);
  const rawCurrency = cleanString(body.currency || 'VND', 10).toUpperCase();
  const currency = VALID_CURRENCY.has(rawCurrency) ? rawCurrency : 'VND';
  const priceVnd = Math.round(quotedPrice * exchangeRate);
  const priceVndInclTax = Math.round(priceVnd * (1 + taxRate / 100));
  const supplierId = cleanString(body.supplierId ?? body.supplier_id, 80);
  return {
    ...base,
    supplier_id: supplierId || null,
    supplier_name: cleanString(body.supplierName ?? body.supplier_name, 180),
    manufacturer: cleanString(body.manufacturer, 180),
    quote_date: cleanString(body.quoteDate ?? body.quote_date, 20),
    quoted_price: quotedPrice,
    currency,
    exchange_rate: exchangeRate,
    price_vnd: priceVnd,
    tax_rate: taxRate,
    price_vnd_incl_tax: priceVndInclTax,
    lead_time: cleanString(body.leadTime ?? body.lead_time, 120),
    valid_until: cleanString(body.validUntil ?? body.valid_until, 20),
    warranty: cleanString(body.warranty, 240),
    note: cleanString(body.note, 2000),
  };
}
