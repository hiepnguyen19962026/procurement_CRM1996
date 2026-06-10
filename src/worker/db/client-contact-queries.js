export async function listClientContactsSQL(db, { clientId }) {
  const res = await db.prepare(
    `SELECT * FROM client_contacts WHERE client_id = ? ORDER BY is_primary DESC, contact_name ASC`
  ).bind(clientId).all();
  return { rows: res.results || [] };
}

export async function getClientContactSQL(db, id) {
  return db.prepare('SELECT * FROM client_contacts WHERE contact_id = ?').bind(id).first();
}

export async function clearPrimaryContactSQL(db, clientId) {
  return db.prepare('UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?').bind(clientId).run();
}

export async function insertClientContactSQL(db, row) {
  return db.prepare(
    `INSERT INTO client_contacts (
      contact_id, client_id, contact_name, department, position,
      role_type, specialty_tags, phone, email, zalo, note,
      is_primary, status, created_by, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.contact_id, row.client_id, row.contact_name, row.department, row.position,
    row.role_type, row.specialty_tags, row.phone, row.email, row.zalo, row.note,
    row.is_primary, row.status, row.created_by, row.created_at, row.updated_at
  ).run();
}

export async function updateClientContactSQL(db, row) {
  return db.prepare(
    `UPDATE client_contacts SET
      contact_name=?, department=?, position=?, role_type=?, specialty_tags=?,
      phone=?, email=?, zalo=?, note=?, is_primary=?, updated_at=?
     WHERE contact_id=?`
  ).bind(
    row.contact_name, row.department, row.position, row.role_type, row.specialty_tags,
    row.phone, row.email, row.zalo, row.note, row.is_primary, row.updated_at,
    row.contact_id
  ).run();
}

export async function archiveClientContactSQL(db, id, updatedAt) {
  return db.prepare(
    `UPDATE client_contacts SET status = 'archived', is_primary = 0, updated_at = ? WHERE contact_id = ?`
  ).bind(updatedAt, id).run();
}
