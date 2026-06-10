export async function listRfqContactsSQL(db, { rfqId }) {
  const res = await db.prepare(
    `SELECT rc.*, cc.contact_name, cc.position, cc.department, cc.role_type,
            cc.specialty_tags, cc.phone, cc.email, cc.zalo
     FROM rfq_contacts rc
     JOIN client_contacts cc ON rc.contact_id = cc.contact_id
     WHERE rc.rfq_id = ? AND rc.status = 'active'
     ORDER BY rc.created_at ASC`
  ).bind(rfqId).all();
  return { rows: res.results || [] };
}

export async function checkRfqContactExistsSQL(db, rfqId, contactId) {
  return db.prepare(
    `SELECT rfq_contact_id FROM rfq_contacts WHERE rfq_id = ? AND contact_id = ? AND status = 'active'`
  ).bind(rfqId, contactId).first();
}

export async function insertRfqContactSQL(db, row) {
  return db.prepare(
    `INSERT INTO rfq_contacts (rfq_contact_id, rfq_id, client_id, contact_id, support_role, note, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.rfq_contact_id, row.rfq_id, row.client_id, row.contact_id,
    row.support_role, row.note, row.status, row.created_by, row.created_at
  ).run();
}

export async function archiveRfqContactSQL(db, id) {
  return db.prepare(`UPDATE rfq_contacts SET status = 'archived' WHERE rfq_contact_id = ?`).bind(id).run();
}
