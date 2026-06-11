import { archiveRfqItemSQL, getRfqItemSQL, insertRfqItemSQL, listRfqItemsSQL, updateRfqItemSQL } from '../db/rfq-item-queries.js';
import { getRfqSQL } from '../db/rfq-queries.js';
import { ALL_ROLES, MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { invalidateKv } from '../lib/cache.js';
import { writeActionLog } from '../lib/action-log.js';
import { buildSearchText, cleanMoney, cleanNumber, cleanString, normalizeText } from '../lib/normalize.js';
import { clampLimit, json, nextEntityId, nowIso, readJson } from '../lib/utils.js';

export async function handleRfqItems(action, request, env, ctx, actor) {
  if (action === 'getRfqItems') return listItems(request, env, actor);
  if (action === 'createRfqItem') return saveItem(request, env, ctx, actor, false);
  if (action === 'updateRfqItem') return saveItem(request, env, ctx, actor, true);
  if (action === 'archiveRfqItem') return archiveItem(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown RFQ item action' }, 400);
}

async function listItems(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const data = await listRfqItemsSQL(env.DB, {
    q: normalizeText(p.q),
    rfqId: p.rfqId || p.rfq_id || '',
    status: p.status || '',
    cursor: p.cursor || '',
    sortBy: p.sortBy || '',
    sortDir: p.sortDir || '',
    limit: clampLimit(p.limit),
  });
  return json({ ok: true, ...data });
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
  ctx.waitUntil(invalidateKv(env, ['dashboard:v1']));
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
  ctx.waitUntil(invalidateKv(env, ['dashboard:v1']));
  ctx.waitUntil(writeActionLog(env, { action: isUpdate ? 'updateRfqItem' : 'createRfqItem', entityType: 'rfq_item', entityId: row.rfq_item_id, oldJson: oldRow, newJson: row, actor }));
  return json({ ok: true, item: row });
}

function v(body, camel, snake, max = 500) {
  return cleanString(body[camel] ?? body[snake], max);
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
  };
  row.normalized_search = buildSearchText([
    row.ma_mua_sam, row.ma_vat_tu, row.ten_vat_tu, row.required_model,
    row.brand, row.manufacturer, row.origin_country, row.manufacture_year,
    row.technical_params, row.vat_lieu, row.yeu_cau_ky_thuat_bo_sung,
  ]);
  return row;
}
