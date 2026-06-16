export async function listTechnicalClarificationsSQL(db, rfqItemId) {
  const res = await db.prepare(
    `SELECT tc.*, mf.file_name AS attachment_file_name
     FROM technical_clarifications tc
     LEFT JOIN media_files mf ON mf.file_id = tc.attachment_file_id
     WHERE tc.rfq_item_id = ? AND tc.deleted_at IS NULL
     ORDER BY tc.created_at DESC, tc.sequence_no DESC`
  ).bind(rfqItemId).all();
  return res.results || [];
}

export async function getTechnicalClarificationSQL(db, clarificationId) {
  return db.prepare(
    `SELECT * FROM technical_clarifications WHERE clarification_id = ?`
  ).bind(clarificationId).first();
}

// VN date-based clarification ID: Cla-YYYY-MMDD-NN, resets per date, collision-safe.
export async function nextClarificationId(db) {
  const d    = new Date(Date.now() + 7 * 60 * 60 * 1000); // UTC+7
  const yyyy = d.toISOString().slice(0, 4);
  const mmdd = d.toISOString().slice(5, 10).replace('-', '');
  const prefix = `Cla-${yyyy}-${mmdd}`;
  const row = await db.prepare(
    `SELECT clarification_id FROM technical_clarifications WHERE clarification_id LIKE ? ORDER BY clarification_id DESC LIMIT 1`
  ).bind(`${prefix}-%`).first();
  const last = row?.clarification_id ? Number(row.clarification_id.split('-').pop()) : 0;
  const seq  = (Number.isFinite(last) ? last : 0) + 1;
  return `${prefix}-${String(seq).padStart(2, '0')}`;
}

export async function nextClarificationSequenceSQL(db, rfqItemId) {
  const row = await db.prepare(
    `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence
     FROM technical_clarifications
     WHERE rfq_item_id = ?`
  ).bind(rfqItemId).first();
  return Number(row?.next_sequence || 1);
}

export async function insertTechnicalClarificationSQL(db, row) {
  return db.prepare(
    `INSERT INTO technical_clarifications (
      clarification_id, rfq_item_id, sequence_no, clarification_type, title, content,
      old_model, proposed_model, proposed_manufacturer, proposed_origin, status_after,
      attachment_file_id, created_by, created_at, updated_at, deleted_at, raw_note, external_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.clarification_id, row.rfq_item_id, row.sequence_no, row.clarification_type, row.title, row.content,
    row.old_model, row.proposed_model, row.proposed_manufacturer, row.proposed_origin, row.status_after,
    row.attachment_file_id, row.created_by, row.created_at, row.updated_at, row.deleted_at, row.raw_note,
    row.external_url || null
  ).run();
}

export async function updateTechnicalClarificationSQL(db, row) {
  return db.prepare(
    `UPDATE technical_clarifications SET
      clarification_type = ?, title = ?, content = ?, old_model = ?, proposed_model = ?,
      proposed_manufacturer = ?, proposed_origin = ?, status_after = ?, attachment_file_id = ?,
      updated_at = ?, raw_note = ?, external_url = ?
     WHERE clarification_id = ? AND deleted_at IS NULL`
  ).bind(
    row.clarification_type, row.title, row.content, row.old_model, row.proposed_model,
    row.proposed_manufacturer, row.proposed_origin, row.status_after, row.attachment_file_id,
    row.updated_at, row.raw_note, row.external_url || null, row.clarification_id
  ).run();
}

export async function quickUpdateClarificationSQL(db, clarificationId, clarificationType, statusAfter, now) {
  return db.prepare(
    'UPDATE technical_clarifications SET clarification_type = ?, status_after = ?, updated_at = ?' +
    ' WHERE clarification_id = ? AND deleted_at IS NULL'
  ).bind(clarificationType, statusAfter, now, clarificationId).run();
}

export async function softDeleteTechnicalClarificationSQL(db, { clarificationId, deletedAt }) {
  return db.prepare(
    `UPDATE technical_clarifications SET deleted_at = ?, updated_at = ?
     WHERE clarification_id = ? AND deleted_at IS NULL`
  ).bind(deletedAt, deletedAt, clarificationId).run();
}

export async function listAllClarificationsSQL(db, { q, q2, q3, sortBy, sortDir, cursor, limit }) {
  const SORT_MAP = {
    created_at:         { col: 'tc.created_at',          field: 'created_at',         noCoalesce: true  },
    clarification_type: { col: 'tc.clarification_type',  field: 'clarification_type',  noCoalesce: false },
    status_after:       { col: 'tc.status_after',        field: 'status_after',        noCoalesce: false },
    ma_goi_tbmt:        { col: 'r.ma_goi_tbmt',          field: 'ma_goi_tbmt',         noCoalesce: false },
    ten_goi:            { col: 'r.ten_goi',              field: 'ten_goi',             noCoalesce: false },
    ma_vat_tu:          { col: 'i.ma_vat_tu',            field: 'ma_vat_tu',           noCoalesce: false },
  };
  const sort = SORT_MAP[sortBy] || SORT_MAP.created_at;
  const dir  = sortDir === 'asc' ? 'ASC' : 'DESC';
  const op   = dir === 'ASC' ? '>' : '<';
  const lim  = Math.min(Number(limit) || 50, 100);

  const where = ['tc.deleted_at IS NULL'];
  const binds = [];

  function addSearch(qv) {
    if (!qv) return;
    const pct = `%${qv}%`;
    where.push(`(tc.clarification_id LIKE ? OR tc.title LIKE ? OR tc.content LIKE ?
      OR i.ma_vat_tu LIKE ? OR i.ten_vat_tu LIKE ?
      OR r.ma_goi_tbmt LIKE ? OR r.ten_goi LIKE ?)`);
    binds.push(pct, pct, pct, pct, pct, pct, pct);
  }
  addSearch(q); addSearch(q2); addSearch(q3);

  const baseWhere = [...where];
  const baseBinds = [...binds];

  if (cursor) {
    const sep     = cursor.indexOf('|||');
    const sortVal = sep === -1 ? null : cursor.slice(0, sep);
    const pk      = sep === -1 ? cursor : cursor.slice(sep + 3);
    const wrap    = sort.noCoalesce ? sort.col : `COALESCE(${sort.col}, '')`;
    if (sortVal === null) {
      where.push(`tc.clarification_id ${op} ?`);
      binds.push(pk);
    } else {
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND tc.clarification_id ${op} ?))`);
      binds.push(sortVal, sortVal, pk);
    }
  }

  const orderBy = `${sort.col} ${dir}, tc.clarification_id ${dir}`;
  const joinSql = `FROM technical_clarifications tc
    JOIN rfq_items i ON i.rfq_item_id = tc.rfq_item_id
    JOIN rfqs r ON r.rfq_id = i.rfq_id`;

  const countSql = `SELECT COUNT(*) AS total ${joinSql} WHERE ${baseWhere.join(' AND ')}`;
  const dataSql  = `SELECT
    tc.clarification_id, tc.created_at, tc.clarification_type, tc.status_after,
    tc.title, tc.content, tc.external_url,
    i.rfq_item_id, i.ma_vat_tu, i.ten_vat_tu, i.rfq_id,
    r.ma_goi_tbmt, r.ten_goi
    ${joinSql}
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT ?`;

  const [countRow, res] = await Promise.all([
    cursor ? Promise.resolve(null) : db.prepare(countSql).bind(...baseBinds).first(),
    db.prepare(dataSql).bind(...binds, lim + 1).all(),
  ]);

  const rows = res.results || [];
  const hasMore = rows.length > lim;
  if (hasMore) rows.pop();

  let nextCursor = null;
  if (hasMore && rows.length > 0) {
    const last = rows[rows.length - 1];
    const sv   = last[sort.field] != null ? String(last[sort.field]) : '';
    nextCursor = `${sv}|||${last.clarification_id}`;
  }

  return { rows, total: countRow ? Number(countRow.total) : null, hasMore, nextCursor };
}

export async function updateRfqItemTechnicalFinalSQL(db, row) {
  return db.prepare(
    `UPDATE rfq_items SET
      quy_cach_final = COALESCE(NULLIF(?, ''), quy_cach_final),
      hang_final = COALESCE(NULLIF(?, ''), hang_final),
      xuat_xu_final = COALESCE(NULLIF(?, ''), xuat_xu_final),
      trang_thai_ky_thuat = ?,
      updated_at = ?
     WHERE rfq_item_id = ?`
  ).bind(row.final_model, row.final_manufacturer, row.final_origin, row.trang_thai_ky_thuat, row.updated_at, row.rfq_item_id).run();
}
