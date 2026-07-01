// Keyset cursor: "sortVal|||pk" for custom sort, plain "pk" for default PK sort.
function parseCursor(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf('|||');
  return idx === -1 ? { pk: cursor, sortVal: undefined } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}

const RFQ_SORT = {
  rfq_id:        { col: 'r.rfq_id',                  rowKey: 'rfq_id',                  type: 'text' },
  ma_goi:        { col: 'r.ma_goi_tbmt',             rowKey: 'ma_goi_tbmt',             type: 'text' },
  ten_goi:       { col: 'r.ten_goi',                 rowKey: 'ten_goi',                 type: 'text' },
  client_name:   { col: 'c.client_name',             rowKey: 'client_name',             type: 'text' },
  ngay_dang_tai: { col: 'r.ngay_nhan_hoac_dang_tai', rowKey: 'ngay_nhan_hoac_dang_tai', type: 'text' },
  han_nop:       { col: 'r.ngay_het_han',            rowKey: 'ngay_het_han',            type: 'text' },
  du_toan:       { col: 'r.du_toan',                 rowKey: 'du_toan',                 type: 'num'  },
  trang_thai:    { col: 'r.trang_thai_goi',          rowKey: 'trang_thai_goi',          type: 'text' },
};

export async function listRfqsSQL(db, { q, status, cursor, sortBy, sortDir, limit, autocomplete = false }) {
  const sort = RFQ_SORT[sortBy] || null;
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const op  = dir === 'ASC' ? '>' : '<';

  const binds = [];
  const where = [];
  if (q) {
    where.push('(r.normalized_search LIKE ? OR r.ten_goi LIKE ? OR r.ma_goi_tbmt LIKE ? OR r.rfq_id LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push('r.trang_thai_goi = ?'); binds.push(status);
  } else {
    where.push("r.trang_thai_goi != 'archived'");
  }
  if (cursor) {
    const c = parseCursor(cursor);
    if (!sort || c.sortVal === undefined) {
      where.push(`r.rfq_id ${op} ?`); binds.push(c.pk);
    } else {
      const wrap = sort.type === 'num' ? `COALESCE(${sort.col}, 0)` : `COALESCE(${sort.col}, '')`;
      const sv = sort.type === 'num' ? Number(c.sortVal) : c.sortVal;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND r.rfq_id ${op} ?))`);
      binds.push(sv, sv, c.pk);
    }
  }

  const orderBy = sort ? `${sort.col} ${dir}, r.rfq_id ${dir}` : `r.rfq_id ${dir}`;
  const selectFields = autocomplete
    ? 'r.rfq_id, r.client_id, r.ma_goi_tbmt, r.ten_goi, r.nha_may_cdt, r.ngay_het_han, r.trang_thai_goi, c.client_name'
    : `r.*, c.client_name,
       (SELECT COUNT(*) FROM rfq_items i WHERE i.rfq_id = r.rfq_id) AS item_count`;
  const res = await db.prepare(
    `SELECT ${selectFields}
     FROM rfqs r LEFT JOIN clients c ON c.client_id = r.client_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit + 1).all();

  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = sort ? String(last[sort.rowKey] ?? '') + '|||' + last.rfq_id : last.rfq_id;
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor };
}

export async function getRfqSQL(db, id) {
  return db.prepare('SELECT * FROM rfqs WHERE rfq_id = ?').bind(id).first();
}

export async function insertRfqSQL(db, row) {
  return db.prepare(
    `INSERT INTO rfqs (rfq_id, client_id, ma_goi_tbmt, ten_goi, nha_may_cdt, ngay_nhan_hoac_dang_tai, ngay_het_han,
       du_toan, trang_thai_goi, source_file_id, note, normalized_search, created_by, created_at, updated_at,
       external_url, warranty_percent, warranty_days, note2)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.rfq_id, row.client_id, row.ma_goi_tbmt, row.ten_goi, row.nha_may_cdt, row.ngay_nhan_hoac_dang_tai, row.ngay_het_han, row.du_toan, row.trang_thai_goi, row.source_file_id, row.note, row.normalized_search, row.created_by, row.created_at, row.updated_at, row.external_url || null, row.warranty_percent ?? null, row.warranty_days ?? null, row.note2 || null).run();
}

export async function updateRfqSQL(db, row) {
  return db.prepare(
    `UPDATE rfqs SET client_id = ?, ma_goi_tbmt = ?, ten_goi = ?, nha_may_cdt = ?, ngay_nhan_hoac_dang_tai = ?,
       ngay_het_han = ?, du_toan = ?, trang_thai_goi = ?, source_file_id = ?, note = ?, normalized_search = ?, updated_at = ?,
       external_url = ?, warranty_percent = ?, warranty_days = ?, note2 = ?
     WHERE rfq_id = ?`
  ).bind(row.client_id, row.ma_goi_tbmt, row.ten_goi, row.nha_may_cdt, row.ngay_nhan_hoac_dang_tai, row.ngay_het_han, row.du_toan, row.trang_thai_goi, row.source_file_id, row.note, row.normalized_search, row.updated_at, row.external_url || null, row.warranty_percent ?? null, row.warranty_days ?? null, row.note2 || null, row.rfq_id).run();
}

export async function archiveRfqSQL(db, rfqId, now) {
  return db.prepare("UPDATE rfqs SET trang_thai_goi = 'archived', updated_at = ? WHERE rfq_id = ?")
    .bind(now, rfqId).run();
}

export async function quickUpdateRfqStatusSQL(db, rfqId, status, now) {
  return db.prepare(
    'UPDATE rfqs SET trang_thai_goi = ?, updated_at = ? WHERE rfq_id = ?'
  ).bind(status, now, rfqId).run();
}

// Report open RFQs that are overdue or due within the next 7 days. Read-only — no mutation.
export async function getRfqDeadlineReportSQL(db, today, d7) {
  const [overdueRow, dueSoonRow, samplesRes] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS n FROM rfqs
       WHERE trang_thai_goi IN ('dang_khao_gia','treo')
         AND ngay_het_han IS NOT NULL AND ngay_het_han != ''
         AND ngay_het_han < ?`
    ).bind(today).first(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM rfqs
       WHERE trang_thai_goi IN ('dang_khao_gia','treo')
         AND ngay_het_han IS NOT NULL AND ngay_het_han != ''
         AND ngay_het_han >= ? AND ngay_het_han <= ?`
    ).bind(today, d7).first(),
    db.prepare(
      `SELECT rfq_id, ma_goi_tbmt, ten_goi, ngay_het_han, trang_thai_goi
       FROM rfqs
       WHERE trang_thai_goi IN ('dang_khao_gia','treo')
         AND ngay_het_han IS NOT NULL AND ngay_het_han != ''
         AND ngay_het_han < ?
       ORDER BY ngay_het_han ASC LIMIT 10`
    ).bind(today).all(),
  ]);
  return {
    overdue_count:  overdueRow?.n || 0,
    due_soon_count: dueSoonRow?.n || 0,
    samples:        samplesRes.results || [],
  };
}

export async function getDashboardSQL(db) {
  const rfqs = await db.prepare('SELECT COUNT(*) AS total FROM rfqs').bind().first();
  const items = await db.prepare('SELECT COUNT(*) AS total FROM rfq_items').bind().first();
  const suppliers = await db.prepare('SELECT COUNT(*) AS total FROM suppliers').bind().first();
  const open = await db.prepare("SELECT COUNT(*) AS total FROM rfqs WHERE trang_thai_goi IN ('dang_khao_gia','treo')").bind().first();
  return { rfqs: rfqs?.total || 0, items: items?.total || 0, suppliers: suppliers?.total || 0, openRfqs: open?.total || 0 };
}
