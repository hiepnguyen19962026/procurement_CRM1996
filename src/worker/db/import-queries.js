export async function listImportTemplatesSQL(db, { ownerKey }) {
  const binds = [];
  const where = ownerKey ? 'WHERE owner_key = ?' : '';
  if (ownerKey) binds.push(ownerKey);
  const res = await db.prepare(
    `SELECT template_id, owner_key, template_name, description, mapping_json, created_by, created_at, updated_at
     FROM import_templates
     ${where}
     ORDER BY updated_at DESC, template_name ASC`
  ).bind(...binds).all();
  return res.results || [];
}

export async function getImportTemplateSQL(db, templateId) {
  return db.prepare(
    `SELECT template_id, owner_key, template_name, description, mapping_json, created_by, created_at, updated_at
     FROM import_templates
     WHERE template_id = ?`
  ).bind(templateId).first();
}

export async function insertImportTemplateSQL(db, row) {
  return db.prepare(
    `INSERT INTO import_templates (
      template_id, owner_key, template_name, description, mapping_json, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.template_id, row.owner_key, row.template_name, row.description, row.mapping_json,
    row.created_by, row.created_at, row.updated_at
  ).run();
}

export async function updateImportTemplateSQL(db, row) {
  return db.prepare(
    `UPDATE import_templates SET
      owner_key = ?, template_name = ?, description = ?, mapping_json = ?, updated_at = ?
     WHERE template_id = ?`
  ).bind(
    row.owner_key, row.template_name, row.description, row.mapping_json, row.updated_at, row.template_id
  ).run();
}

export async function insertImportJobSQL(db, row) {
  return db.prepare(
    `INSERT INTO import_jobs (
      job_id, owner_key, rfq_id, source_file_name, source_sheet_name, status, total_rows,
      created_count, updated_count, skipped_count, error_count, created_by, created_at, committed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.job_id, row.owner_key, row.rfq_id, row.source_file_name, row.source_sheet_name, row.status,
    row.total_rows, row.created_count, row.updated_count, row.skipped_count, row.error_count,
    row.created_by, row.created_at, row.committed_at
  ).run();
}

export async function getImportJobSQL(db, jobId) {
  return db.prepare(
    `SELECT job_id, owner_key, rfq_id, source_file_name, source_sheet_name, status, total_rows,
      created_count, updated_count, skipped_count, error_count, created_by, created_at, committed_at
     FROM import_jobs
     WHERE job_id = ?`
  ).bind(jobId).first();
}

export async function listImportJobRowsSQL(db, { jobId, limit }) {
  const res = await db.prepare(
    `SELECT job_row_id, job_id, source_row_number, raw_row_json, mapped_json, status, error_message,
      rfq_id, rfq_item_id, created_at
     FROM import_job_rows
     WHERE job_id = ?
     ORDER BY source_row_number ASC, job_row_id ASC
     LIMIT ?`
  ).bind(jobId, limit).all();
  return res.results || [];
}

export async function insertImportJobRowSQL(db, row) {
  return db.prepare(
    `INSERT INTO import_job_rows (
      job_row_id, job_id, source_row_number, raw_row_json, mapped_json, status, error_message,
      rfq_id, rfq_item_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.job_row_id, row.job_id, row.source_row_number, row.raw_row_json, row.mapped_json,
    row.status, row.error_message, row.rfq_id, row.rfq_item_id, row.created_at
  ).run();
}

export async function findDuplicateRfqItemSQL(db, { rfqId, maVatTu, sttGoc }) {
  if (maVatTu && sttGoc) {
    const row = await db.prepare(
      `SELECT * FROM rfq_items
       WHERE rfq_id = ? AND ma_vat_tu = ? AND stt_goc = ?
       ORDER BY created_at DESC, rfq_item_id DESC
       LIMIT 1`
    ).bind(rfqId, maVatTu, sttGoc).first();
    if (row) return row;
  }
  if (maVatTu) {
    const row = await db.prepare(
      `SELECT * FROM rfq_items
       WHERE rfq_id = ? AND ma_vat_tu = ?
       ORDER BY created_at DESC, rfq_item_id DESC
       LIMIT 1`
    ).bind(rfqId, maVatTu).first();
    if (row) return row;
  }
  if (sttGoc) {
    return db.prepare(
      `SELECT * FROM rfq_items
       WHERE rfq_id = ? AND stt_goc = ?
       ORDER BY created_at DESC, rfq_item_id DESC
       LIMIT 1`
    ).bind(rfqId, sttGoc).first();
  }
  return null;
}

export async function listRfqItemsByRfqIdSQL(db, rfqId) {
  const res = await db.prepare(
    `SELECT rfq_item_id, rfq_id, stt_goc, source_row_number,
       ma_mua_sam, ma_vat_tu, ten_vat_tu, required_model, quantity, unit,
       manufacturer, brand, origin_country, manufacture_year, technical_params,
       vat_lieu, phu_tung_chuyen_dung, yeu_cau_ky_thuat_bo_sung,
       thue_suat, don_gia_truoc_thue, thanh_tien_sau_thue, gia_hop_dong, delivery_time, note
     FROM rfq_items
     WHERE rfq_id = ? AND trang_thai_dong != 'archived'
     ORDER BY COALESCE(source_row_number, 0) ASC, rfq_item_id ASC`
  ).bind(rfqId).all();
  return res.results || [];
}
