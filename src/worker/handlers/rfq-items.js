import { archiveRfqItemSQL, exportRfqItemsSQL, getRfqItemSQL, insertRfqItemSQL, listRfqItemsSQL, updateRfqItemSQL } from '../db/rfq-item-queries.js';
import { getRfqSQL } from '../db/rfq-queries.js';
import { ALL_ROLES, MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { invalidateKv } from '../lib/cache.js';
import { writeActionLog } from '../lib/action-log.js';
import { buildSearchText, cleanMoney, cleanNumber, cleanString, normalizeText } from '../lib/normalize.js';
import { clampLimit, json, nextEntityId, nowIso, readJson } from '../lib/utils.js';

export async function handleRfqItems(action, request, env, ctx, actor) {
  if (action === 'getRfqItems') return listItems(request, env, actor);
  if (action === 'getRfqItem') return getOneItem(request, env, actor);
  if (action === 'createRfqItem') return saveItem(request, env, ctx, actor, false);
  if (action === 'updateRfqItem') return saveItem(request, env, ctx, actor, true);
  if (action === 'archiveRfqItem') return archiveItem(request, env, ctx, actor);
  if (action === 'hardDeleteRfqItems') return hardDelete(request, env, ctx, actor);
  if (action === 'hardDeleteAllRfqItems') return hardDeleteAll(request, env, ctx, actor);
  if (action === 'logRfqItemImportSummary') return logImportSummary(request, env, ctx, actor);
  if (action === 'exportRfqItemsCsv') return exportItems(request, env, actor);
  if (action === 'exportRfqItemsJson') return exportItemsJson(request, env, actor);
  return json({ ok: false, error: 'Unknown RFQ item action' }, 400);
}

async function getOneItem(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const rfqItemId = p.rfqItemId || p.rfq_item_id || '';
  if (!rfqItemId) return json({ ok: false, error: 'Missing rfqItemId' }, 400);
  const row = await getRfqItemSQL(env.DB, rfqItemId);
  if (!row) return json({ ok: false, error: 'RFQ item not found' }, 404);
  return json({ ok: true, row });
}

async function listItems(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const VALID_TECH_FILTERS = new Set(['has_clarification','no_clarification','khong_can','dang_hoi','da_xac_nhan','bi_tu_choi']);
  const data = await listRfqItemsSQL(env.DB, {
    q: normalizeText(p.q),
    q2: normalizeText(p.q2),
    q3: normalizeText(p.q3),
    rfqId: p.rfqId || p.rfq_id || '',
    status: p.status || '',
    techFilter: VALID_TECH_FILTERS.has(p.techFilter) ? p.techFilter : '',
    cursor: p.cursor || '',
    sortBy: p.sortBy || '',
    sortDir: p.sortDir || '',
    limit: clampLimit(p.limit, 500, 10000),
  });
  return json({ ok: true, ...data });
}

async function logImportSummary(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId  = cleanString(body.rfqId  || body.rfq_id, 80);
  const rfqName = cleanString(body.rfqName || '', 240);
  const created = Math.max(0, Number(body.created) || 0);
  const updated = Math.max(0, Number(body.updated) || 0);
  const errors  = Math.max(0, Number(body.errors)  || 0);
  const label   = rfqName ? `"${rfqName}" (${rfqId})` : rfqId;
  const parts   = [`tạo ${created}`, `cập nhật ${updated}`];
  if (errors) parts.push(`lỗi ${errors}`);
  ctx.waitUntil(writeActionLog(env, {
    action:     'importRfqItems',
    entityType: 'rfq_item',
    entityId:   rfqId,
    message:    `Import dòng vật tư vào gói ${label}: ${parts.join(', ')}`,
    actor,
  }));
  return json({ ok: true });
}

async function archiveItem(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id, 80);
  if (!rfqItemId) return json({ ok: false, error: 'Thieu ma dong vat tu' }, 400);
  const row = await getRfqItemSQL(env.DB, rfqItemId);
  if (!row) return json({ ok: false, error: 'Khong tim thay dong vat tu' }, 404);
  const now = nowIso();
  await archiveRfqItemSQL(env.DB, rfqItemId, now);
  ctx.waitUntil(invalidateKv(env, ['dashboard:v1', 'dashboard:v2']));
  ctx.waitUntil(writeActionLog(env, { action: 'archiveRfqItem', entityType: 'rfq_item', entityId: rfqItemId, oldJson: row, newJson: null, actor }));
  return json({ ok: true });
}

async function saveItem(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 80);
  const name = cleanString(body.tenVatTu || body.ten_vat_tu, 500);
  if (!rfqId || !name) return json({ ok: false, error: 'RFQ va ten vat tu la bat buoc' }, 400);
  const rfq = await getRfqSQL(env.DB, rfqId);
  if (!rfq) return json({ ok: false, error: 'RFQ khong ton tai' }, 400);
  const now = nowIso();
  const oldRow = isUpdate ? await getRfqItemSQL(env.DB, body.rfqItemId || body.rfq_item_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: 'Khong tim thay dong RFQ' }, 404);
  const row = normalizeItemRow(body, {
    rfq_item_id: isUpdate ? oldRow.rfq_item_id : await nextEntityId(env.DB, 'rfq_items', 'rfq_item_id', 'RFQI'),
    rfq_id: rfqId,
    ten_vat_tu: name,
    created_at: oldRow?.created_at || now,
    updated_at: now,
  });
  if (isUpdate) await updateRfqItemSQL(env.DB, row);
  else await insertRfqItemSQL(env.DB, row);
  ctx.waitUntil(invalidateKv(env, ['dashboard:v1', 'dashboard:v2']));
  // silent=true is passed by the simple CSV import loop to avoid per-row audit spam;
  // batch imports use commitImportRows which logs its own summary entry.
  if (!body.silent) {
    ctx.waitUntil(writeActionLog(env, {
      action:     isUpdate ? 'updateRfqItem' : 'createRfqItem',
      entityType: 'rfq_item',
      entityId:   row.rfq_item_id,
      message:    isUpdate
        ? `Cập nhật dòng vật tư: "${name}" (${row.rfq_item_id}) — gói ${rfqId}`
        : `Thêm dòng vật tư: "${name}" — gói ${rfqId}`,
      oldJson:    oldRow,
      newJson:    row,
      actor,
    }));
  }
  return json({ ok: true, item: row });
}

function v(body, camel, snake, max = 500) {
  return cleanString(body[camel] ?? body[snake], max);
}

function cleanUrl(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  return s.slice(0, 2000);
}

function firstText(body, keys, max = 500) {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null) return cleanString(body[key], max);
  }
  return '';
}

function firstNumber(body, keys) {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null) return cleanNumber(body[key]);
  }
  return 0;
}

function normalizeItemRow(body, base) {
  const requiredModel = firstText(body, ['requiredModel', 'required_model', 'quyCachModelYeuCau', 'quy_cach_model_yeu_cau'], 1000);
  const brand = firstText(body, ['brand', 'nhanHieu', 'nhan_hieu'], 120);
  const manufactureYear = firstText(body, ['manufactureYear', 'manufacture_year', 'namSanXuat', 'nam_san_xuat'], 40);
  const originCountry = firstText(body, ['originCountry', 'origin_country', 'xuatXu', 'xuat_xu'], 120);
  const manufacturer = firstText(body, ['manufacturer', 'hangGocNsxGoc', 'hang_goc_nsx_goc'], 180);
  const technicalParams = firstText(body, ['technicalParams', 'technical_params', 'thongSoKyThuat', 'thong_so_ky_thuat'], 2000);
  const unit = firstText(body, ['unit', 'donVi', 'don_vi'], 80);
  const quantity = firstNumber(body, ['quantity', 'soLuong', 'so_luong']);
  const row = {
    ...base,
    stt_goc: v(body, 'sttGoc', 'stt_goc', 40),
    id_import_goc: v(body, 'idImportGoc', 'id_import_goc', 120),
    ma_mua_sam: v(body, 'maMuaSam', 'ma_mua_sam', 120),
    ma_vat_tu: v(body, 'maVatTu', 'ma_vat_tu', 120),
    required_model: requiredModel,
    brand,
    manufacture_year: manufactureYear,
    origin_country: originCountry,
    manufacturer,
    technical_params: technicalParams,
    unit,
    quantity,
    origin_full_text: v(body, 'originFullText', 'origin_full_text', 1500),
    delivery_time: v(body, 'deliveryTime', 'delivery_time', 180),
    note: v(body, 'note', 'note', 1500),
    quy_cach_model_yeu_cau: requiredModel,
    hang_goc_nsx_goc: manufacturer,
    hang_bao_gia_nsx_bao_gia: v(body, 'hangBaoGiaNsxBaoGia', 'hang_bao_gia_nsx_bao_gia', 180),
    nhan_hieu: brand,
    xuat_xu: originCountry,
    nam_san_xuat: manufactureYear,
    vat_lieu: v(body, 'vatLieu', 'vat_lieu', 180),
    phu_tung_chuyen_dung: v(body, 'phuTungChuyenDung', 'phu_tung_chuyen_dung', 80),
    thong_so_ky_thuat: technicalParams,
    yeu_cau_ky_thuat_bo_sung: v(body, 'yeuCauKyThuatBoSung', 'yeu_cau_ky_thuat_bo_sung', 1500),
    so_luong: quantity,
    don_vi: unit,
    thue_suat: cleanNumber(body.thueSuat ?? body.thue_suat),
    don_gia_truoc_thue: cleanMoney(body.donGiaTruocThue ?? body.don_gia_truoc_thue),
    don_gia_sau_thue: cleanMoney(body.donGiaSauThue ?? body.don_gia_sau_thue),
    thanh_tien_sau_thue: cleanMoney(body.thanhTienSauThue ?? body.thanh_tien_sau_thue),
    gia_hop_dong: cleanMoney(body.giaHopDong ?? body.gia_hop_dong),
    nguon_gia: v(body, 'nguonGia', 'nguon_gia', 120),
    trang_thai_dong: v(body, 'trangThaiDong', 'trang_thai_dong', 80) || 'chua_xu_ly',
    trang_thai_ky_thuat: v(body, 'trangThaiKyThuat', 'trang_thai_ky_thuat', 80) || 'khong_can_xac_nhan',
    quy_cach_final: v(body, 'quyCachFinal', 'quy_cach_final', 1000),
    hang_final: v(body, 'hangFinal', 'hang_final', 180),
    xuat_xu_final: v(body, 'xuatXuFinal', 'xuat_xu_final', 120),
    ghi_chu_final: v(body, 'ghiChuFinal', 'ghi_chu_final', 1500),
    item_id: v(body, 'itemId', 'item_id', 80),
    raw_row_json: typeof body.rawRowJson === 'object' ? JSON.stringify(body.rawRowJson) : v(body, 'rawRowJson', 'raw_row_json', 5000),
    source_file_id: v(body, 'sourceFileId', 'source_file_id', 120),
    source_sheet_name: v(body, 'sourceSheetName', 'source_sheet_name', 120),
    source_row_number: Math.trunc(cleanNumber(body.sourceRowNumber ?? body.source_row_number)),
    external_url: cleanUrl(body.externalUrl ?? body.external_url),
  };
  row.normalized_search = buildSearchText([
    row.ma_mua_sam, row.ma_vat_tu, row.ten_vat_tu, row.required_model,
    row.brand, row.manufacturer, row.origin_country, row.manufacture_year,
    row.technical_params, row.vat_lieu, row.yeu_cau_ky_thuat_bo_sung,
    row.hang_bao_gia_nsx_bao_gia, row.note,
    row.quy_cach_final, row.hang_final, row.xuat_xu_final, row.ghi_chu_final,
  ]);
  return row;
}

async function hardDelete(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const ids = (body.rfqItemIds || body.rfq_item_ids || []).map(s => cleanString(s, 80)).filter(Boolean);
  if (!ids.length) return json({ ok: false, error: 'Khong co dong nao duoc chon' }, 400);
  if (ids.length > 500) return json({ ok: false, error: 'Toi da 500 dong moi lan xoa' }, 400);
  const ph = ids.map(() => '?').join(',');
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM technical_clarifications WHERE rfq_item_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`DELETE FROM supplier_quotes WHERE rfq_item_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`DELETE FROM pricing_decisions WHERE rfq_item_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`DELETE FROM contract_items WHERE rfq_item_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`DELETE FROM rfq_item_revisions WHERE rfq_item_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`UPDATE import_job_rows SET rfq_item_id = NULL WHERE rfq_item_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`DELETE FROM rfq_items WHERE rfq_item_id IN (${ph})`).bind(...ids),
  ]);
  ctx.waitUntil(invalidateKv(env, ['dashboard:v1', 'dashboard:v2']));
  ctx.waitUntil(writeActionLog(env, { action: 'hardDeleteRfqItems', entityType: 'rfq_item', entityId: ids.join(','), actor }));
  return json({ ok: true, deleted: ids.length });
}

const EXPORT_MAX_ROWS = 5000;

const EXPORT_COL_HEADERS = [
  'Mã gói', 'Tên gói',
  'STT', 'Mã mua sắm', 'Mã vật tư',
  'Tên vật tư / Danh mục hàng hóa', 'Ký mã hiệu / Model', 'Nhãn hiệu',
  'Năm sản xuất', 'Xuất xứ', 'Hãng sản xuất', 'Quy cách / thông số kỹ thuật',
  'Vật liệu', 'Phụ tùng chuyên dụng', 'Yêu cầu kỹ thuật bổ sung',
  'Đơn vị tính', 'Khối lượng', 'Thuế suất', 'Đơn giá', 'Thành tiền', 'Đơn giá HĐ', 'Thành tiền HĐ',
  'Thời gian giao hàng', 'Ghi chú', 'Làm rõ',
];

function maVatTuExcel(v) {
  // Force Excel to treat numeric-looking material codes as text (prevents 1E+ scientific notation)
  if (v == null || v === '') return '';
  return '="' + String(v).replace(/"/g, '""') + '"';
}

function rowToExportCsv(r) {
  return [
    r.ma_goi_tbmt, r.ten_goi,
    r.stt_goc, r.ma_mua_sam, maVatTuExcel(r.ma_vat_tu),
    r.ten_vat_tu,
    r.required_model || r.quy_cach_model_yeu_cau || '',
    r.brand || r.nhan_hieu || '',
    r.manufacture_year || r.nam_san_xuat || '',
    r.origin_country || r.xuat_xu || '',
    r.manufacturer || r.hang_goc_nsx_goc || '',
    r.technical_params || r.thong_so_ky_thuat || '',
    r.vat_lieu || '', r.phu_tung_chuyen_dung || '', r.yeu_cau_ky_thuat_bo_sung || '',
    r.unit || r.don_vi || '',
    r.quantity ?? r.so_luong ?? '',
    r.thue_suat ?? '',
    r.don_gia_truoc_thue || r.don_gia_sau_thue || '',
    r.thanh_tien_sau_thue || '',
    r.gia_hop_dong || '',
    r.gia_hop_dong ? r.gia_hop_dong * (parseFloat(r.quantity ?? r.so_luong ?? 0) || 0) : '',
    r.delivery_time || '', r.note || '',
    r.latest_clarification_title || '',
  ];
}

const EXPORT_TEMPLATES = {
  vt1_lam_ro_1: {
    headers: ['编号','需求计划编号','物资编码','物资名称','规格型号','原设备制造商生产厂','投标设备品牌/生产厂','订购单位','订购数量','交货时间','备注','问题'],
    row: r => [
      r.stt_goc, r.ma_mua_sam, maVatTuExcel(r.ma_vat_tu),
      r.ten_vat_tu,
      r.required_model || r.quy_cach_model_yeu_cau || '',
      r.brand || r.nhan_hieu || '',
      r.technical_params || r.thong_so_ky_thuat || '',
      r.unit || r.don_vi || '',
      r.quantity ?? r.so_luong ?? '',
      r.delivery_time || '',
      r.note || '',
      r.latest_clarification_title || '',
    ],
    textCols: [2],
    longTextCols: [3, 4, 6, 10, 11],
    leftAlignCols: [3, 4, 6, 11],
  },
  vt1_lam_ro_2: {
    headers: ['编号','需求计划编号','物资编码','物资名称','图片','规格型号','图号','材质','原设备制造商生产厂','是否专用件','是否停产件','订购数量','订购单位','技术参数、安装尺寸及特殊要求','投标设备品牌/生产厂','问题','回答'],
    row: r => [
      r.stt_goc, r.ma_mua_sam, maVatTuExcel(r.ma_vat_tu),
      r.ten_vat_tu,
      '',
      r.required_model || r.quy_cach_model_yeu_cau || '',
      '',
      r.vat_lieu || '',
      r.brand || r.nhan_hieu || '',
      r.phu_tung_chuyen_dung || '',
      '',
      r.quantity ?? r.so_luong ?? '',
      r.unit || r.don_vi || '',
      r.yeu_cau_ky_thuat_bo_sung || '',
      r.technical_params || r.thong_so_ky_thuat || '',
      r.latest_clarification_title || '',
      '',
    ],
    textCols: [2],
    longTextCols: [3, 5, 13, 14, 15, 16],
    leftAlignCols: [3, 5, 13, 14, 15],
  },
  kq_muasamcong: {
    headers: ['STT','Danh mục hàng hóa','Ký mã hiệu','Nhãn hiệu','Năm sản xuất','Xuất xứ (quốc gia, vùng lãnh thổ sản xuất)','Hãng sản xuất','Cấu hình, tính năng kỹ thuật cơ bản','Đơn vị tính','Khối lượng','Mã HS','Đơn giá trúng thầu','Thành tiền đã bao gồm thuế, phí, lệ phí (nếu có)','Thời gian giao hàng (ngày)/ Tiến độ cung cấp'],
    row: r => [
      r.stt_goc,
      r.ten_vat_tu,
      r.required_model || r.quy_cach_model_yeu_cau || '',
      r.brand || r.nhan_hieu || '',
      r.manufacture_year || r.nam_san_xuat || '',
      r.origin_country || r.xuat_xu || '',
      r.manufacturer || r.hang_goc_nsx_goc || '',
      r.technical_params || r.thong_so_ky_thuat || '',
      r.unit || r.don_vi || '',
      r.quantity ?? r.so_luong ?? '',
      '',
      r.don_gia_truoc_thue || r.don_gia_sau_thue || '',
      r.thanh_tien_sau_thue || '',
      r.delivery_time || '',
    ],
    textCols: [],
    longTextCols: [1, 2, 7],
    leftAlignCols: [1, 2, 7],
  },
};

function csvQ(value) {
  const s = String(value == null ? '' : value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildExportCsv(rows, opts) {
  const template = (opts && opts.template) || 'chung';
  const colMask = (opts && opts.colMask) || [];
  const prefix = prefaceCsvLines(rows);
  if (template !== 'chung' && EXPORT_TEMPLATES[template]) {
    const tpl = EXPORT_TEMPLATES[template];
    const lines = [...prefix, tpl.headers.map(csvQ).join(',')];
    for (const r of rows) lines.push(tpl.row(r).map(csvQ).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
  // Chung: apply optional column mask
  const headers = EXPORT_COL_HEADERS;
  const indices = colMask.length
    ? colMask.map(c => headers.indexOf(c)).filter(i => i >= 0)
    : headers.map((_, i) => i);
  const activeIndices = indices.length ? indices : headers.map((_, i) => i);
  const filteredHeaders = activeIndices.map(i => headers[i]);
  const lines = [...prefix, filteredHeaders.map(csvQ).join(',')];
  for (const r of rows) {
    const vals = rowToExportCsv(r);
    lines.push(activeIndices.map(i => csvQ(vals[i])).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

async function exportItems(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const VALID_TECH_FILTERS = new Set(['has_clarification','no_clarification','khong_can','dang_hoi','da_xac_nhan','bi_tu_choi']);
  const VALID_TEMPLATES = new Set(['chung', 'vt1_lam_ro_1', 'vt1_lam_ro_2', 'kq_muasamcong']);
  const rawTemplate = cleanString(p.exportTemplate || 'chung', 40);
  const template = VALID_TEMPLATES.has(rawTemplate) ? rawTemplate : 'chung';
  // selectedIds: export only these rows (if provided); else export all matching filter
  const rawIds = Array.isArray(p.selectedIds) ? p.selectedIds : [];
  const selectedIds = rawIds.map(s => cleanString(String(s), 80)).filter(Boolean).slice(0, 500);
  // cols: column mask only applies to 'chung' template
  const rawCols = template === 'chung' && Array.isArray(p.cols) ? p.cols : [];
  const colMask = rawCols.map(s => cleanString(String(s), 120)).filter(Boolean);
  const rows = await exportRfqItemsSQL(env.DB, {
    q: normalizeText(p.q),
    q2: normalizeText(p.q2),
    q3: normalizeText(p.q3),
    rfqId: p.rfqId || p.rfq_id || '',
    status: p.status || '',
    techFilter: VALID_TECH_FILTERS.has(p.techFilter) ? p.techFilter : '',
    sortBy: p.sortBy || '',
    sortDir: p.sortDir || '',
    selectedIds,
  });
  const rfqId = cleanString(p.rfqId || p.rfq_id || 'all', 80);
  const today = nowIso().slice(0, 10);
  const tplSuffix = template === 'chung' ? '' : '-' + template.replace(/_/g, '-');
  return json({
    ok: true,
    filename: `rfq-items${tplSuffix}-${rfqId}-${today}.csv`,
    csv: buildExportCsv(rows, { template, colMask }),
    row_count: rows.length,
    capped: rows.length >= EXPORT_MAX_ROWS,
  });
}

function rawMaVatTu(v) {
  // Strip ="..." Excel formula wrapper (from maVatTuExcel) for raw JSON/XLSX export
  if (typeof v === 'string' && v.startsWith('="') && v.endsWith('"')) {
    return v.slice(2, -1).replace(/""/g, '"');
  }
  return v;
}

const CHUNG_LONG_HEADERS = new Set([
  'Tên gói', 'Tên vật tư / Danh mục hàng hóa', 'Ký mã hiệu / Model',
  'Quy cách / thông số kỹ thuật', 'Yêu cầu kỹ thuật bổ sung', 'Ghi chú', 'Làm rõ',
]);
const CHUNG_LEFT_ALIGN_HEADERS = new Set([
  'Tên vật tư / Danh mục hàng hóa', 'Ký mã hiệu / Model',
  'Quy cách / thông số kỹ thuật', 'Yêu cầu kỹ thuật bổ sung', 'Làm rõ',
]);

function buildExportPreface(rows) {
  if (!rows.length) return ['', '', ''];
  const keys = new Set(rows.map(r => r.rfq_id || r.ma_goi_tbmt || '').filter(Boolean));
  if (keys.size !== 1) return ['', '', ''];
  const key = [...keys][0];
  const r = rows.find(x => (x.rfq_id || x.ma_goi_tbmt || '') === key) || rows[0];
  return [r.ma_goi_tbmt || '', r.ten_goi || '', r.ten_cdt || ''];
}

function prefaceCsvLines(rows) {
  return buildExportPreface(rows).map(csvQ);
}

function buildExportJson(rows, opts) {
  const template = (opts && opts.template) || 'chung';
  const colMask = (opts && opts.colMask) || [];
  const preface = buildExportPreface(rows);

  if (template !== 'chung' && EXPORT_TEMPLATES[template]) {
    const tpl = EXPORT_TEMPLATES[template];
    return {
      headers: tpl.headers,
      rows: rows.map(r => tpl.row(r).map(rawMaVatTu)),
      textCols: tpl.textCols,
      longTextCols: tpl.longTextCols,
      leftAlignCols: tpl.leftAlignCols,
      preface,
    };
  }

  // Chung with optional colMask
  const allHeaders = EXPORT_COL_HEADERS;
  const indices = colMask.length
    ? colMask.map(c => allHeaders.indexOf(c)).filter(i => i >= 0)
    : allHeaders.map((_, i) => i);
  const activeIndices = indices.length ? indices : allHeaders.map((_, i) => i);
  const headers = activeIndices.map(i => allHeaders[i]);
  return {
    headers,
    rows: rows.map(r => {
      const vals = rowToExportCsv(r);
      return activeIndices.map(i => rawMaVatTu(vals[i]));
    }),
    textCols: headers.reduce((acc, h, i) => { if (h === 'Mã vật tư') acc.push(i); return acc; }, []),
    longTextCols: headers.reduce((acc, h, i) => { if (CHUNG_LONG_HEADERS.has(h)) acc.push(i); return acc; }, []),
    leftAlignCols: headers.reduce((acc, h, i) => { if (CHUNG_LEFT_ALIGN_HEADERS.has(h)) acc.push(i); return acc; }, []),
    preface,
  };
}

async function exportItemsJson(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const VALID_TECH_FILTERS = new Set(['has_clarification','no_clarification','khong_can','dang_hoi','da_xac_nhan','bi_tu_choi']);
  const VALID_TEMPLATES = new Set(['chung', 'vt1_lam_ro_1', 'vt1_lam_ro_2', 'kq_muasamcong']);
  const rawTemplate = cleanString(p.exportTemplate || 'chung', 40);
  const template = VALID_TEMPLATES.has(rawTemplate) ? rawTemplate : 'chung';
  const rawIds = Array.isArray(p.selectedIds) ? p.selectedIds : [];
  const selectedIds = rawIds.map(s => cleanString(String(s), 80)).filter(Boolean).slice(0, 500);
  const rawCols = template === 'chung' && Array.isArray(p.cols) ? p.cols : [];
  const colMask = rawCols.map(s => cleanString(String(s), 120)).filter(Boolean);
  const rows = await exportRfqItemsSQL(env.DB, {
    q: normalizeText(p.q),
    q2: normalizeText(p.q2),
    q3: normalizeText(p.q3),
    rfqId: p.rfqId || p.rfq_id || '',
    status: p.status || '',
    techFilter: VALID_TECH_FILTERS.has(p.techFilter) ? p.techFilter : '',
    sortBy: p.sortBy || '',
    sortDir: p.sortDir || '',
    selectedIds,
  });
  const rfqId = cleanString(p.rfqId || p.rfq_id || 'all', 80);
  const today = nowIso().slice(0, 10);
  const tplSuffix = template === 'chung' ? '' : '-' + template.replace(/_/g, '-');
  const { headers, rows: dataRows, textCols, longTextCols, leftAlignCols, preface } = buildExportJson(rows, { template, colMask });
  return json({
    ok: true,
    filename: `rfq-items${tplSuffix}-${rfqId}-${today}.xlsx`,
    headers,
    rows: dataRows,
    preface: preface || ['', '', ''],
    textCols: textCols || [],
    longTextCols: longTextCols || [],
    leftAlignCols: leftAlignCols || [],
    row_count: rows.length,
    capped: rows.length >= EXPORT_MAX_ROWS,
  });
}

async function hardDeleteAll(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 80);
  if (!rfqId) return json({ ok: false, error: 'Thieu rfqId' }, 400);
  const rfq = await getRfqSQL(env.DB, rfqId);
  if (!rfq) return json({ ok: false, error: 'RFQ khong ton tai' }, 404);
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM rfq_items WHERE rfq_id = ?').bind(rfqId).first();
  const totalCount = countRow?.n || 0;
  if (!totalCount) return json({ ok: true, deleted: 0 });
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM technical_clarifications WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
    env.DB.prepare(`DELETE FROM supplier_quotes WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
    env.DB.prepare(`DELETE FROM pricing_decisions WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
    env.DB.prepare(`DELETE FROM contract_items WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
    env.DB.prepare(`DELETE FROM rfq_item_revisions WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
    env.DB.prepare(`UPDATE import_job_rows SET rfq_item_id = NULL WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
    env.DB.prepare(`DELETE FROM rfq_items WHERE rfq_id = ?`).bind(rfqId),
  ]);
  ctx.waitUntil(invalidateKv(env, ['dashboard:v1', 'dashboard:v2']));
  ctx.waitUntil(writeActionLog(env, { action: 'hardDeleteAllRfqItems', entityType: 'rfq', entityId: rfqId, actor }));
  return json({ ok: true, deleted: totalCount });
}
