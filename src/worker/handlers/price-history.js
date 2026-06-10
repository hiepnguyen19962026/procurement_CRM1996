import {
  exportPriceHistorySQL,
  getPriceHistorySummarySQL,
  searchPriceHistorySQL,
} from '../db/price-history-queries.js';
import { ALL_ROLES, requireRole } from '../lib/auth.js';
import { cleanNumber, cleanString } from '../lib/normalize.js';
import { clampLimit, json, readJson } from '../lib/utils.js';

const VALID_SOURCE_CHANNEL = new Set(['', 'zalo', 'wechat', 'email', 'phone', 'direct', 'other']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EXPORT_ROWS = 5000;

export async function handlePriceHistory(action, request, env, _ctx, actor) {
  if (action === 'searchPriceHistory')    return searchHistory(request, env, actor);
  if (action === 'getPriceHistorySummary') return summaryHistory(request, env, actor);
  if (action === 'exportPriceHistoryCsv') return exportHistoryCsv(request, env, actor);
  return json({ ok: false, error: 'Unknown price history action' }, 400);
}

async function searchHistory(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);

  const limit = clampLimit(body.limit, 50, 200);
  const filters = parseFilters(body);
  const err = validateFilters(filters);
  if (err) return json({ ok: false, error: err }, 400);

  // Cursor: sort_date|quote_id
  let cursorSortDate = null;
  let cursorQuoteId = null;
  const cursorRaw = cleanString(body.cursor || '', 200);
  if (cursorRaw) {
    const parts = cursorRaw.split('|');
    if (parts.length === 2 && parts[0] && parts[1]) {
      cursorSortDate = parts[0];
      cursorQuoteId = parts[1];
    }
  }

  const rows = await searchPriceHistorySQL(env.DB, {
    ...filters,
    cursorSortDate,
    cursorQuoteId,
    limit: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  let nextCursor = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = (last.sort_date || last.created_at) + '|' + last.quote_id;
  }
  return json({ ok: true, rows: page, hasMore, nextCursor });
}

async function summaryHistory(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const filters = parseFilters(body);
  const err = validateFilters(filters);
  if (err) return json({ ok: false, error: err }, 400);
  const summary = await getPriceHistorySummarySQL(env.DB, filters);
  return json({ ok: true, summary });
}

async function exportHistoryCsv(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const filters = parseFilters(body);
  const err = validateFilters(filters);
  if (err) return json({ ok: false, error: err }, 400);

  const rows = await exportPriceHistorySQL(env.DB, { ...filters, limit: MAX_EXPORT_ROWS });
  const csv = buildCsv(rows);

  // Filename includes date and a filter hint.
  const today = new Date().toISOString().slice(0, 10);
  const hint = filters.rfqItemId || filters.itemId || filters.rfqId || filters.maVatTu || 'all';
  const safeHint = String(hint).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);
  const filename = `price-history-${safeHint}-${today}.csv`;

  return json({ ok: true, filename, csv, row_count: rows.length });
}

// Parse + sanitize all filter params from request body.
function parseFilters(body) {
  return {
    rfqItemId:     cleanString(body.rfqItemId    || body.rfq_item_id    || '', 80),
    itemId:        cleanString(body.itemId        || body.item_id        || '', 80),
    q:             cleanString(body.q             || '', 200),
    maVatTu:       cleanString(body.maVatTu       || body.ma_vat_tu      || '', 80),
    supplierId:    cleanString(body.supplierId    || body.supplier_id    || '', 80),
    supplierName:  cleanString(body.supplierName  || body.supplier_name  || '', 180),
    rfqId:         cleanString(body.rfqId         || body.rfq_id         || '', 80),
    clientId:      cleanString(body.clientId      || body.client_id      || '', 80),
    sourceChannel: cleanString((body.sourceChannel || body.source_channel || ''), 20).toLowerCase(),
    dateFrom:      cleanString(body.dateFrom      || body.date_from      || '', 20),
    dateTo:        cleanString(body.dateTo        || body.date_to        || '', 20),
  };
}

// Validate optional constrained fields. Returns error string or null.
function validateFilters(f) {
  if (f.sourceChannel && !VALID_SOURCE_CHANNEL.has(f.sourceChannel)) {
    return 'sourceChannel khong hop le';
  }
  if (f.dateFrom && !DATE_RE.test(f.dateFrom)) return 'dateFrom phai la YYYY-MM-DD';
  if (f.dateTo   && !DATE_RE.test(f.dateTo))   return 'dateTo phai la YYYY-MM-DD';
  return null;
}

// CSV helpers.
function csvQuote(value) {
  const s = String(value == null ? '' : value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const CSV_HEADERS = [
  'Mã báo giá', 'Mã dòng VT', 'Mã master item',
  'Mã VT (master)', 'Tên VT (master)', 'Quy cách (master)',
  'Mã VT', 'Tên VT', 'Quy cách/model', 'Hãng SX', 'Nhãn hiệu', 'Xuất xứ', 'ĐVT', 'Số lượng',
  'Mã RFQ', 'Mã gói TBMT', 'Tên gói', 'CĐT/Nhà máy', 'Client ID',
  'NCC ID', 'Tên NCC',
  'Ngày báo giá', 'Ngày nhận', 'Kênh', 'Tham chiếu nguồn',
  'Giá báo', 'Tiền tệ', 'Tỷ giá', 'Giá VND', 'Thuế %', 'Giá VND+Thuế',
  'Giao hàng', 'Hiệu lực đến', 'Bảo hành', 'Ghi chú',
  'Trạng thái', 'Ngày tạo', 'Số minh chứng',
];

function rowToCsvValues(r) {
  return [
    r.quote_id, r.rfq_item_id, r.item_id || '',
    r.master_ma_vat_tu || '', r.master_ten_vat_tu || '', r.master_spec || '',
    r.ma_vat_tu || '', r.ten_vat_tu || '', r.required_model || '',
    r.manufacturer || '', r.brand || '', r.origin_country || '',
    r.unit || '', r.quantity ?? '',
    r.rfq_id || '', r.ma_goi_tbmt || '', r.ten_goi || '', r.nha_may_cdt || '', r.client_id || '',
    r.supplier_id || '', r.supplier_name || '',
    r.quote_date || '', r.received_at || '', r.source_channel || '', r.source_ref || '',
    r.quoted_price ?? 0, r.currency || '', r.exchange_rate ?? 1,
    r.price_vnd ?? 0, r.tax_rate ?? 0, r.price_vnd_incl_tax ?? 0,
    r.lead_time || '', r.valid_until || '', r.warranty || '', r.note || '',
    r.status || '', r.created_at || '', r.evidence_count ?? 0,
  ];
}

function buildCsv(rows) {
  const lines = [CSV_HEADERS.map(csvQuote).join(',')];
  for (const r of rows) {
    lines.push(rowToCsvValues(r).map(csvQuote).join(','));
  }
  // UTF-8 BOM so Excel auto-detects encoding.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
