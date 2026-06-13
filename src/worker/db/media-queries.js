export async function insertMediaFileSQL(db, row) {
  return db.prepare(
    `INSERT INTO media_files (file_id, owner_type, owner_id, file_kind, r2_key, public_url, file_name, mime_type,
      size_bytes, width, height, variant, is_primary, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.file_id, row.owner_type, row.owner_id, row.file_kind, row.r2_key, row.public_url, row.file_name, row.mime_type, row.size_bytes, row.width, row.height, row.variant, row.is_primary, row.created_by, row.created_at).run();
}

export async function listMediaFilesSQL(db, { ownerType, ownerId, limit }) {
  const res = await db.prepare(
    `SELECT file_id, owner_type, owner_id, file_kind, file_name, mime_type, size_bytes,
      width, height, variant, is_primary, created_by, created_at
     FROM media_files
     WHERE owner_type = ? AND owner_id = ?
     ORDER BY created_at DESC, file_id DESC LIMIT ?`
  ).bind(ownerType, ownerId, limit).all();
  return res.results || [];
}

// Report media_files rows whose owner no longer exists in D1.
// D1-side only — no R2 listing, no R2 delete, no D1 delete.
export async function getOrphanMediaReportSQL(db) {
  const [quoteRow, rfqItemRow, samplesRes] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS n FROM media_files mf
       WHERE mf.owner_type = 'quote'
         AND NOT EXISTS (
           SELECT 1 FROM supplier_quotes sq WHERE sq.quote_id = mf.owner_id
         )`
    ).first(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM media_files mf
       WHERE mf.owner_type = 'rfq_item'
         AND NOT EXISTS (
           SELECT 1 FROM rfq_items ri WHERE ri.rfq_item_id = mf.owner_id
         )`
    ).first(),
    db.prepare(
      `SELECT mf.file_id, mf.owner_type, mf.owner_id, mf.file_kind, mf.r2_key, mf.created_at
       FROM media_files mf
       WHERE
         (mf.owner_type = 'quote' AND NOT EXISTS (
           SELECT 1 FROM supplier_quotes sq WHERE sq.quote_id = mf.owner_id
         ))
         OR
         (mf.owner_type = 'rfq_item' AND NOT EXISTS (
           SELECT 1 FROM rfq_items ri WHERE ri.rfq_item_id = mf.owner_id
         ))
       ORDER BY mf.created_at ASC LIMIT 20`
    ).all(),
  ]);
  return {
    quote_orphan_count:    quoteRow?.n || 0,
    rfq_item_orphan_count: rfqItemRow?.n || 0,
    samples:               samplesRes.results || [],
  };
}

export async function getMediaKeysByOwnerSQL(db, ownerType, ownerId) {
  const res = await db.prepare(
    `SELECT file_id, r2_key FROM media_files
     WHERE owner_type = ? AND owner_id = ?`
  ).bind(ownerType, ownerId).all();
  return res.results || [];
}

export async function deleteMediaFilesByOwnerSQL(db, ownerType, ownerId) {
  return db.prepare(
    `DELETE FROM media_files WHERE owner_type = ? AND owner_id = ?`
  ).bind(ownerType, ownerId).run();
}

export async function getMediaFileSQL(db, fileId) {
  const res = await db.prepare(
    `SELECT file_id, owner_type, owner_id, file_kind, r2_key, file_name, mime_type, size_bytes,
      width, height, variant, is_primary, created_by, created_at
     FROM media_files
     WHERE file_id = ?`
  ).bind(fileId).first();
  return res || null;
}
