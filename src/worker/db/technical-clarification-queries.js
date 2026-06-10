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
      attachment_file_id, created_by, created_at, updated_at, deleted_at, raw_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.clarification_id, row.rfq_item_id, row.sequence_no, row.clarification_type, row.title, row.content,
    row.old_model, row.proposed_model, row.proposed_manufacturer, row.proposed_origin, row.status_after,
    row.attachment_file_id, row.created_by, row.created_at, row.updated_at, row.deleted_at, row.raw_note
  ).run();
}

export async function updateTechnicalClarificationSQL(db, row) {
  return db.prepare(
    `UPDATE technical_clarifications SET
      clarification_type = ?, title = ?, content = ?, old_model = ?, proposed_model = ?,
      proposed_manufacturer = ?, proposed_origin = ?, status_after = ?, attachment_file_id = ?,
      updated_at = ?, raw_note = ?
     WHERE clarification_id = ? AND deleted_at IS NULL`
  ).bind(
    row.clarification_type, row.title, row.content, row.old_model, row.proposed_model,
    row.proposed_manufacturer, row.proposed_origin, row.status_after, row.attachment_file_id,
    row.updated_at, row.raw_note, row.clarification_id
  ).run();
}

export async function softDeleteTechnicalClarificationSQL(db, { clarificationId, deletedAt }) {
  return db.prepare(
    `UPDATE technical_clarifications SET deleted_at = ?, updated_at = ?
     WHERE clarification_id = ? AND deleted_at IS NULL`
  ).bind(deletedAt, deletedAt, clarificationId).run();
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
