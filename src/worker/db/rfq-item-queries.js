export async function listRfqItemsSQL(db, { q, rfqId, status, cursor, limit }) {
  const binds = [];
  const where = [];
  if (q) {
    where.push('(i.normalized_search LIKE ? OR i.ten_vat_tu LIKE ? OR i.ma_vat_tu LIKE ? OR i.ma_mua_sam LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (rfqId) {
    where.push('i.rfq_id = ?');
    binds.push(rfqId);
  }
  if (status) {
    where.push('i.trang_thai_dong = ?');
    binds.push(status);
  }
  if (cursor) {
    where.push('i.rfq_item_id < ?');
    binds.push(cursor);
  }
  const res = await db.prepare(
    `SELECT i.*, r.ten_goi, r.ma_goi_tbmt
     FROM rfq_items i LEFT JOIN rfqs r ON r.rfq_id = i.rfq_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY i.created_at DESC, i.rfq_item_id DESC LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const rows = res.results || [];
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit, nextCursor: rows.length > limit ? rows[limit - 1].rfq_item_id : null };
}

export async function getRfqItemSQL(db, id) {
  return db.prepare('SELECT * FROM rfq_items WHERE rfq_item_id = ?').bind(id).first();
}

export async function insertRfqItemSQL(db, row) {
  return db.prepare(
    `INSERT INTO rfq_items (
      rfq_item_id, rfq_id, stt_goc, id_import_goc, ma_mua_sam, ma_vat_tu, ten_vat_tu,
      required_model, brand, manufacture_year, origin_country, manufacturer, technical_params, unit, quantity,
      origin_full_text, delivery_time, note,
      quy_cach_model_yeu_cau, hang_goc_nsx_goc, hang_bao_gia_nsx_bao_gia, nhan_hieu, xuat_xu, nam_san_xuat,
      vat_lieu, phu_tung_chuyen_dung, thong_so_ky_thuat, yeu_cau_ky_thuat_bo_sung, so_luong, don_vi,
      thue_suat, don_gia_truoc_thue, don_gia_sau_thue, thanh_tien_sau_thue, nguon_gia,
      trang_thai_dong, trang_thai_ky_thuat, quy_cach_final, hang_final, xuat_xu_final, ghi_chu_final,
      item_id, normalized_search, raw_row_json, source_file_id, source_sheet_name, source_row_number, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.rfq_item_id, row.rfq_id, row.stt_goc, row.id_import_goc, row.ma_mua_sam, row.ma_vat_tu, row.ten_vat_tu,
    row.required_model, row.brand, row.manufacture_year, row.origin_country, row.manufacturer, row.technical_params, row.unit, row.quantity,
    row.origin_full_text, row.delivery_time, row.note,
    row.quy_cach_model_yeu_cau, row.hang_goc_nsx_goc, row.hang_bao_gia_nsx_bao_gia, row.nhan_hieu, row.xuat_xu, row.nam_san_xuat,
    row.vat_lieu, row.phu_tung_chuyen_dung, row.thong_so_ky_thuat, row.yeu_cau_ky_thuat_bo_sung, row.so_luong, row.don_vi,
    row.thue_suat, row.don_gia_truoc_thue, row.don_gia_sau_thue, row.thanh_tien_sau_thue, row.nguon_gia,
    row.trang_thai_dong, row.trang_thai_ky_thuat, row.quy_cach_final, row.hang_final, row.xuat_xu_final, row.ghi_chu_final,
    row.item_id, row.normalized_search, row.raw_row_json, row.source_file_id, row.source_sheet_name, row.source_row_number, row.created_at, row.updated_at
  ).run();
}

export async function updateRfqItemSQL(db, row) {
  return db.prepare(
    `UPDATE rfq_items SET
      rfq_id = ?, stt_goc = ?, id_import_goc = ?, ma_mua_sam = ?, ma_vat_tu = ?, ten_vat_tu = ?,
      required_model = ?, brand = ?, manufacture_year = ?, origin_country = ?, manufacturer = ?, technical_params = ?, unit = ?, quantity = ?,
      origin_full_text = ?, delivery_time = ?, note = ?,
      quy_cach_model_yeu_cau = ?, hang_goc_nsx_goc = ?, hang_bao_gia_nsx_bao_gia = ?, nhan_hieu = ?, xuat_xu = ?, nam_san_xuat = ?,
      vat_lieu = ?, phu_tung_chuyen_dung = ?, thong_so_ky_thuat = ?, yeu_cau_ky_thuat_bo_sung = ?, so_luong = ?, don_vi = ?,
      thue_suat = ?, don_gia_truoc_thue = ?, don_gia_sau_thue = ?, thanh_tien_sau_thue = ?, nguon_gia = ?,
      trang_thai_dong = ?, trang_thai_ky_thuat = ?, quy_cach_final = ?, hang_final = ?, xuat_xu_final = ?, ghi_chu_final = ?,
      item_id = ?, normalized_search = ?, raw_row_json = ?, source_file_id = ?, source_sheet_name = ?, source_row_number = ?, updated_at = ?
     WHERE rfq_item_id = ?`
  ).bind(
    row.rfq_id, row.stt_goc, row.id_import_goc, row.ma_mua_sam, row.ma_vat_tu, row.ten_vat_tu,
    row.required_model, row.brand, row.manufacture_year, row.origin_country, row.manufacturer, row.technical_params, row.unit, row.quantity,
    row.origin_full_text, row.delivery_time, row.note,
    row.quy_cach_model_yeu_cau, row.hang_goc_nsx_goc, row.hang_bao_gia_nsx_bao_gia, row.nhan_hieu, row.xuat_xu, row.nam_san_xuat,
    row.vat_lieu, row.phu_tung_chuyen_dung, row.thong_so_ky_thuat, row.yeu_cau_ky_thuat_bo_sung, row.so_luong, row.don_vi,
    row.thue_suat, row.don_gia_truoc_thue, row.don_gia_sau_thue, row.thanh_tien_sau_thue, row.nguon_gia,
    row.trang_thai_dong, row.trang_thai_ky_thuat, row.quy_cach_final, row.hang_final, row.xuat_xu_final, row.ghi_chu_final,
    row.item_id, row.normalized_search, row.raw_row_json, row.source_file_id, row.source_sheet_name, row.source_row_number, row.updated_at,
    row.rfq_item_id
  ).run();
}
