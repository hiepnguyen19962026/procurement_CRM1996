function parseCursor(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf('|||');
  return idx === -1 ? { pk: cursor, sortVal: undefined } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}

const ITEM_SORT = {
  stt:            { col: 'i.stt_goc',          rowKey: 'stt_goc',          type: 'text' },
  ma_mua_sam:     { col: 'i.ma_mua_sam',        rowKey: 'ma_mua_sam',       type: 'text' },
  ma_vat_tu:      { col: 'i.ma_vat_tu',         rowKey: 'ma_vat_tu',        type: 'text' },
  ten_vat_tu:     { col: 'i.ten_vat_tu',        rowKey: 'ten_vat_tu',       type: 'text' },
  required_model: { col: 'i.required_model',    rowKey: 'required_model',   type: 'text' },
  brand:          { col: 'i.brand',             rowKey: 'brand',            type: 'text' },
  manufacturer:   { col: 'i.manufacturer',      rowKey: 'manufacturer',     type: 'text' },
  origin_country: { col: 'i.origin_country',    rowKey: 'origin_country',   type: 'text' },
  trang_thai:     { col: 'i.trang_thai_dong',   rowKey: 'trang_thai_dong',  type: 'text' },
};

export async function listRfqItemsSQL(db, { q, rfqId, status, techFilter, cursor, sortBy, sortDir, limit }) {
  const sort = ITEM_SORT[sortBy] || null;
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const op  = dir === 'ASC' ? '>' : '<';

  const binds = [];
  const where = [];
  if (q) {
    where.push('(i.normalized_search LIKE ? OR i.ten_vat_tu LIKE ? OR i.ma_vat_tu LIKE ? OR i.ma_mua_sam LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (rfqId) { where.push('i.rfq_id = ?'); binds.push(rfqId); }
  if (status) {
    where.push('i.trang_thai_dong = ?'); binds.push(status);
  } else {
    where.push("i.trang_thai_dong != 'archived'");
  }
  if (techFilter === 'has_clarification') {
    where.push('EXISTS (SELECT 1 FROM technical_clarifications tc WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL)');
  } else if (techFilter === 'no_clarification') {
    where.push('NOT EXISTS (SELECT 1 FROM technical_clarifications tc WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL)');
  } else if (techFilter === 'khong_can') {
    where.push("i.trang_thai_ky_thuat = 'khong_can_xac_nhan'");
  } else if (techFilter === 'dang_hoi') {
    where.push("i.trang_thai_ky_thuat IN ('dang_hoi','can_bo_sung','processing','waiting_supplier','waiting_client','need_more_info')");
  } else if (techFilter === 'da_xac_nhan') {
    where.push("i.trang_thai_ky_thuat IN ('da_xac_nhan','final_confirmed')");
  } else if (techFilter === 'bi_tu_choi') {
    where.push("i.trang_thai_ky_thuat IN ('bi_tu_choi','rejected','thay_the')");
  }
  const baseWhere = [...where];
  const baseBinds = [...binds];

  if (cursor) {
    const c = parseCursor(cursor);
    if (!sort) {
      if (c.sortVal === undefined) {
        where.push(`i.rfq_item_id > ?`); binds.push(c.pk);
      } else {
        where.push(`(COALESCE(i.source_row_number, 0) > ? OR (COALESCE(i.source_row_number, 0) = ? AND i.rfq_item_id > ?))`);
        binds.push(Number(c.sortVal), Number(c.sortVal), c.pk);
      }
    } else if (c.sortVal === undefined) {
      where.push(`i.rfq_item_id ${op} ?`); binds.push(c.pk);
    } else {
      const wrap = `COALESCE(${sort.col}, '')`;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND i.rfq_item_id ${op} ?))`);
      binds.push(c.sortVal, c.sortVal, c.pk);
    }
  }

  // innerOrderBy uses table alias `i.` (valid inside CTE); outerOrderBy strips it (CTE exposes bare column names)
  // Default (no sort): order by source import row so items appear in spreadsheet order
  const innerOrderBy = sort ? `${sort.col} ${dir}, i.rfq_item_id ${dir}` : `COALESCE(i.source_row_number, 0) ASC, i.rfq_item_id ASC`;
  const outerOrderBy = sort ? `${sort.col.replace(/^\w+\./, '')} ${dir}, rfq_item_id ${dir}` : `COALESCE(source_row_number, 0) ASC, rfq_item_id ASC`;
  const countSql = `SELECT COUNT(*) AS total FROM rfq_items i${baseWhere.length ? ` WHERE ${baseWhere.join(' AND ')}` : ''}`;
  const [countRow, res] = await Promise.all([
    db.prepare(countSql).bind(...baseBinds).first(),
    db.prepare(
      `WITH page AS (
         SELECT i.*, r.ten_goi, r.ma_goi_tbmt
         FROM rfq_items i LEFT JOIN rfqs r ON r.rfq_id = i.rfq_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY ${innerOrderBy} LIMIT ?
       )
       SELECT page.*,
         (SELECT COUNT(*) FROM technical_clarifications tc WHERE tc.rfq_item_id = page.rfq_item_id AND tc.deleted_at IS NULL) AS clarification_count,
         (SELECT tc.status_after FROM technical_clarifications tc WHERE tc.rfq_item_id = page.rfq_item_id AND tc.deleted_at IS NULL ORDER BY tc.created_at DESC, tc.sequence_no DESC LIMIT 1) AS clarification_status
       FROM page ORDER BY ${outerOrderBy}`
    ).bind(...binds, limit + 1).all(),
  ]);

  const totalCount = Number(countRow?.total ?? 0);
  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    if (sort) {
      nextCursor = String(last[sort.rowKey] ?? '') + '|||' + last.rfq_item_id;
    } else {
      nextCursor = String(last.source_row_number ?? 0) + '|||' + last.rfq_item_id;
    }
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor, totalCount };
}

export async function archiveRfqItemSQL(db, rfqItemId, now) {
  return db.prepare("UPDATE rfq_items SET trang_thai_dong = 'archived', updated_at = ? WHERE rfq_item_id = ?")
    .bind(now, rfqItemId).run();
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
      thue_suat, don_gia_truoc_thue, don_gia_sau_thue, thanh_tien_sau_thue, gia_hop_dong, nguon_gia,
      trang_thai_dong, trang_thai_ky_thuat, quy_cach_final, hang_final, xuat_xu_final, ghi_chu_final,
      item_id, normalized_search, raw_row_json, source_file_id, source_sheet_name, source_row_number, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.rfq_item_id, row.rfq_id, row.stt_goc, row.id_import_goc, row.ma_mua_sam, row.ma_vat_tu, row.ten_vat_tu,
    row.required_model, row.brand, row.manufacture_year, row.origin_country, row.manufacturer, row.technical_params, row.unit, row.quantity,
    row.origin_full_text, row.delivery_time, row.note,
    row.quy_cach_model_yeu_cau, row.hang_goc_nsx_goc, row.hang_bao_gia_nsx_bao_gia, row.nhan_hieu, row.xuat_xu, row.nam_san_xuat,
    row.vat_lieu, row.phu_tung_chuyen_dung, row.thong_so_ky_thuat, row.yeu_cau_ky_thuat_bo_sung, row.so_luong, row.don_vi,
    row.thue_suat, row.don_gia_truoc_thue, row.don_gia_sau_thue, row.thanh_tien_sau_thue, row.gia_hop_dong || 0, row.nguon_gia,
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
      thue_suat = ?, don_gia_truoc_thue = ?, don_gia_sau_thue = ?, thanh_tien_sau_thue = ?, gia_hop_dong = ?, nguon_gia = ?,
      trang_thai_dong = ?, trang_thai_ky_thuat = ?, quy_cach_final = ?, hang_final = ?, xuat_xu_final = ?, ghi_chu_final = ?,
      item_id = ?, normalized_search = ?, raw_row_json = ?, source_file_id = ?, source_sheet_name = ?, source_row_number = ?, updated_at = ?
     WHERE rfq_item_id = ?`
  ).bind(
    row.rfq_id, row.stt_goc, row.id_import_goc, row.ma_mua_sam, row.ma_vat_tu, row.ten_vat_tu,
    row.required_model, row.brand, row.manufacture_year, row.origin_country, row.manufacturer, row.technical_params, row.unit, row.quantity,
    row.origin_full_text, row.delivery_time, row.note,
    row.quy_cach_model_yeu_cau, row.hang_goc_nsx_goc, row.hang_bao_gia_nsx_bao_gia, row.nhan_hieu, row.xuat_xu, row.nam_san_xuat,
    row.vat_lieu, row.phu_tung_chuyen_dung, row.thong_so_ky_thuat, row.yeu_cau_ky_thuat_bo_sung, row.so_luong, row.don_vi,
    row.thue_suat, row.don_gia_truoc_thue, row.don_gia_sau_thue, row.thanh_tien_sau_thue, row.gia_hop_dong || 0, row.nguon_gia,
    row.trang_thai_dong, row.trang_thai_ky_thuat, row.quy_cach_final, row.hang_final, row.xuat_xu_final, row.ghi_chu_final,
    row.item_id, row.normalized_search, row.raw_row_json, row.source_file_id, row.source_sheet_name, row.source_row_number, row.updated_at,
    row.rfq_item_id
  ).run();
}
