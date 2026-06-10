export async function listRfqsSQL(db, { q, status, cursor, limit }) {
  const binds = [];
  const where = [];
  if (q) {
    where.push('(r.normalized_search LIKE ? OR r.ten_goi LIKE ? OR r.ma_goi_tbmt LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push('r.trang_thai_goi = ?');
    binds.push(status);
  }
  if (cursor) {
    where.push('r.rfq_id < ?');
    binds.push(cursor);
  }
  const res = await db.prepare(
    `SELECT r.*, c.client_name
     FROM rfqs r LEFT JOIN clients c ON c.client_id = r.client_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.created_at DESC, r.rfq_id DESC LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const rows = res.results || [];
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit, nextCursor: rows.length > limit ? rows[limit - 1].rfq_id : null };
}

export async function getRfqSQL(db, id) {
  return db.prepare('SELECT * FROM rfqs WHERE rfq_id = ?').bind(id).first();
}

export async function insertRfqSQL(db, row) {
  return db.prepare(
    `INSERT INTO rfqs (rfq_id, client_id, ma_goi_tbmt, ten_goi, nha_may_cdt, ngay_nhan_hoac_dang_tai, ngay_het_han,
       du_toan, trang_thai_goi, source_file_id, note, normalized_search, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.rfq_id, row.client_id, row.ma_goi_tbmt, row.ten_goi, row.nha_may_cdt, row.ngay_nhan_hoac_dang_tai, row.ngay_het_han, row.du_toan, row.trang_thai_goi, row.source_file_id, row.note, row.normalized_search, row.created_by, row.created_at, row.updated_at).run();
}

export async function updateRfqSQL(db, row) {
  return db.prepare(
    `UPDATE rfqs SET client_id = ?, ma_goi_tbmt = ?, ten_goi = ?, nha_may_cdt = ?, ngay_nhan_hoac_dang_tai = ?,
       ngay_het_han = ?, du_toan = ?, trang_thai_goi = ?, source_file_id = ?, note = ?, normalized_search = ?, updated_at = ?
     WHERE rfq_id = ?`
  ).bind(row.client_id, row.ma_goi_tbmt, row.ten_goi, row.nha_may_cdt, row.ngay_nhan_hoac_dang_tai, row.ngay_het_han, row.du_toan, row.trang_thai_goi, row.source_file_id, row.note, row.normalized_search, row.updated_at, row.rfq_id).run();
}

export async function getDashboardSQL(db) {
  const rfqs = await db.prepare('SELECT COUNT(*) AS total FROM rfqs').bind().first();
  const items = await db.prepare('SELECT COUNT(*) AS total FROM rfq_items').bind().first();
  const suppliers = await db.prepare('SELECT COUNT(*) AS total FROM suppliers').bind().first();
  const open = await db.prepare("SELECT COUNT(*) AS total FROM rfqs WHERE trang_thai_goi IN ('dang_khao_gia','treo')").bind().first();
  return { rfqs: rfqs?.total || 0, items: items?.total || 0, suppliers: suppliers?.total || 0, openRfqs: open?.total || 0 };
}
