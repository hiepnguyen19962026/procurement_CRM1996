export async function listClientBankAccountsSQL(db, { clientId }) {
  const res = await db.prepare(
    `SELECT * FROM client_bank_accounts WHERE client_id = ? ORDER BY is_primary DESC, created_at ASC`
  ).bind(clientId).all();
  return { rows: res.results || [] };
}

export async function getClientBankAccountSQL(db, id) {
  return db.prepare('SELECT * FROM client_bank_accounts WHERE bank_account_id = ?').bind(id).first();
}

export async function clearPrimaryBankAccountSQL(db, clientId) {
  return db.prepare('UPDATE client_bank_accounts SET is_primary = 0 WHERE client_id = ?').bind(clientId).run();
}

export async function insertClientBankAccountSQL(db, row) {
  return db.prepare(
    `INSERT INTO client_bank_accounts (
      bank_account_id, client_id, account_name, bank_account, bank_name,
      branch_name, currency, is_primary, status, note, created_by, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.bank_account_id, row.client_id, row.account_name, row.bank_account, row.bank_name,
    row.branch_name, row.currency, row.is_primary, row.status, row.note,
    row.created_by, row.created_at, row.updated_at
  ).run();
}

export async function updateClientBankAccountSQL(db, row) {
  return db.prepare(
    `UPDATE client_bank_accounts SET
      account_name=?, bank_account=?, bank_name=?, branch_name=?,
      currency=?, is_primary=?, note=?, updated_at=?
     WHERE bank_account_id=?`
  ).bind(
    row.account_name, row.bank_account, row.bank_name, row.branch_name,
    row.currency, row.is_primary, row.note, row.updated_at,
    row.bank_account_id
  ).run();
}

export async function archiveClientBankAccountSQL(db, id, updatedAt) {
  return db.prepare(
    `UPDATE client_bank_accounts SET status = 'archived', is_primary = 0, updated_at = ? WHERE bank_account_id = ?`
  ).bind(updatedAt, id).run();
}
