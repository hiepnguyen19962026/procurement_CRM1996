export async function listClientLegalHistorySQL(db, { clientId }) {
  const res = await db.prepare(
    `SELECT * FROM client_legal_history WHERE client_id = ? ORDER BY effective_date DESC, created_at DESC`
  ).bind(clientId).all();
  return { rows: res.results || [] };
}

export async function insertClientLegalHistorySQL(db, row) {
  return db.prepare(
    `INSERT INTO client_legal_history (
      legal_history_id, client_id, effective_date, legal_name, tax_code, address, note, created_by, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.legal_history_id, row.client_id, row.effective_date,
    row.legal_name, row.tax_code, row.address, row.note,
    row.created_by, row.created_at
  ).run();
}
