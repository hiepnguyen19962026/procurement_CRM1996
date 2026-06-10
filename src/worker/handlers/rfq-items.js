import { getRfqItemSQL, insertRfqItemSQL, listRfqItemsSQL, updateRfqItemSQL } from '../db/rfq-item-queries.js';
import { getRfqSQL } from '../db/rfq-queries.js';
import { ALL_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { invalidateKv } from '../lib/cache.js';
import { writeActionLog } from '../lib/action-log.js';
import { buildSearchText, cleanMoney, cleanNumber, cleanString, normalizeText } from '../lib/normalize.js';
import { clampLimit, json, nextEntityId, nowIso, readJson } from '../lib/utils.js';

export async function handleRfqItems(action, request, env, ctx, actor) {
  if (action === 'getRfqItems') return listItems(request, env, actor);
  if (action === 'createRfqItem') return saveItem(request, env, ctx, actor, false);
  if (action === 'updateRfqItem') return saveItem(request, env, ctx, actor, true);
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
    limit: clampLimit(p.limit),
  });
  return json({ ok: true, ...data });
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

function normalizeItemRow(body, base) {
  const row = {
    ...base,
    stt_goc: v(body, 'sttGoc', 'stt_goc', 40),
    id_import_goc: v(body, 'idImportGoc', 'id_import_goc', 120),
    ma_mua_sam: v(body, 'maMuaSam', 'ma_mua_sam', 120),
    ma_vat_tu: v(body, 'maVatTu', 'ma_vat_tu', 120),
    quy_cach_model_yeu_cau: v(body, 'quyCachModelYeuCau', 'quy_cach_model_yeu_cau', 1000),
    hang_goc_nsx_goc: v(body, 'hangGocNsxGoc', 'hang_goc_nsx_goc', 180),
    hang_bao_gia_nsx_bao_gia: v(body, 'hangBaoGiaNsxBaoGia', 'hang_bao_gia_nsx_bao_gia', 180),
    nhan_hieu: v(body, 'nhanHieu', 'nhan_hieu', 120),
    xuat_xu: v(body, 'xuatXu', 'xuat_xu', 120),
    nam_san_xuat: v(body, 'namSanXuat', 'nam_san_xuat', 40),
    vat_lieu: v(body, 'vatLieu', 'vat_lieu', 180),
    phu_tung_chuyen_dung: v(body, 'phuTungChuyenDung', 'phu_tung_chuyen_dung', 80),
    thong_so_ky_thuat: v(body, 'thongSoKyThuat', 'thong_so_ky_thuat', 2000),
    yeu_cau_ky_thuat_bo_sung: v(body, 'yeuCauKyThuatBoSung', 'yeu_cau_ky_thuat_bo_sung', 1500),
    so_luong: cleanNumber(body.soLuong ?? body.so_luong),
    don_vi: v(body, 'donVi', 'don_vi', 80),
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
    row.ma_mua_sam, row.ma_vat_tu, row.ten_vat_tu, row.quy_cach_model_yeu_cau,
    row.hang_goc_nsx_goc, row.hang_bao_gia_nsx_bao_gia, row.xuat_xu, row.thong_so_ky_thuat,
  ]);
  return row;
}
