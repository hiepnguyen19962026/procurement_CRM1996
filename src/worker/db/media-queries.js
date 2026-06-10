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

export async function getMediaFileSQL(db, fileId) {
  const res = await db.prepare(
    `SELECT file_id, owner_type, owner_id, file_kind, r2_key, file_name, mime_type, size_bytes,
      width, height, variant, is_primary, created_by, created_at
     FROM media_files
     WHERE file_id = ?`
  ).bind(fileId).first();
  return res || null;
}
