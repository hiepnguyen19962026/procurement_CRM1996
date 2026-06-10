// sort expression reused across contract list queries
const CONTRACT_SORT_EXPR = "COALESCE(c.signed_date, c.created_at)";

export async function listContractsSQL(db, params) {
  const { q, rfqId, clientId, status, dateFrom, dateTo, cursorSortDate, cursorContractId, limit } = params;
  const conds = [];
  const binds = [];

  if (rfqId)    { conds.push('c.rfq_id = ?');    binds.push(rfqId); }
  if (clientId) { conds.push('c.client_id = ?'); binds.push(clientId); }
  if (status)   { conds.push('c.status = ?');    binds.push(status); }
  if (dateFrom) { conds.push(`${CONTRACT_SORT_EXPR} >= ?`); binds.push(dateFrom); }
  if (dateTo)   { conds.push(`${CONTRACT_SORT_EXPR} <= ?`); binds.push(dateTo); }
  if (q) {
    const like = '%' + q + '%';
    conds.push('(c.contract_no LIKE ? OR c.contract_name LIKE ? OR c.note LIKE ? OR cl.client_name LIKE ?)');
    binds.push(like, like, like, like);
  }
  if (cursorSortDate && cursorContractId) {
    conds.push(
      `(${CONTRACT_SORT_EXPR} < ? OR (${CONTRACT_SORT_EXPR} = ? AND c.contract_id < ?))`
    );
    binds.push(cursorSortDate, cursorSortDate, cursorContractId);
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const sql = `
    SELECT c.*,
      cl.client_name,
      (SELECT COUNT(*) FROM contract_items ci WHERE ci.contract_id = c.contract_id AND ci.status = 'active') AS item_count
    FROM contracts c
    LEFT JOIN clients cl ON cl.client_id = c.client_id
    ${where}
    ORDER BY ${CONTRACT_SORT_EXPR} DESC, c.contract_id DESC
    LIMIT ?
  `;
  const res = await db.prepare(sql).bind(...binds, limit).all();
  return res.results || [];
}

export async function getContractSQL(db, contractId) {
  return db.prepare('SELECT * FROM contracts WHERE contract_id = ?').bind(contractId).first();
}

export async function getContractItemsSQL(db, contractId) {
  const res = await db.prepare(
    `SELECT * FROM contract_items WHERE contract_id = ? ORDER BY created_at ASC`
  ).bind(contractId).all();
  return res.results || [];
}

// Contract items for a given rfq_item_id — used in RFQ item detail modal.
export async function getContractItemsForRfqItemSQL(db, rfqItemId) {
  const res = await db.prepare(
    `SELECT ci.*, c.contract_no, c.signed_date, c.contract_name,
            c.status AS contract_status, c.currency AS contract_currency,
            c.rfq_id AS contract_rfq_id
     FROM contract_items ci
     JOIN contracts c ON c.contract_id = ci.contract_id
     WHERE ci.rfq_item_id = ?
     ORDER BY COALESCE(c.signed_date, c.created_at) DESC, ci.created_at DESC
     LIMIT 20`
  ).bind(rfqItemId).all();
  return res.results || [];
}

export async function insertContractSQL(db, row) {
  return db.prepare(
    `INSERT INTO contracts (
      contract_id, rfq_id, contract_no, contract_name, client_id,
      signed_date, effective_date, expiry_date, currency, contract_total,
      status, note, created_by, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.contract_id, row.rfq_id, row.contract_no, row.contract_name, row.client_id,
    row.signed_date, row.effective_date, row.expiry_date, row.currency, row.contract_total,
    row.status, row.note, row.created_by, row.created_at, row.updated_at, row.archived_at
  ).run();
}

export async function updateContractSQL(db, row) {
  return db.prepare(
    `UPDATE contracts SET
      rfq_id = ?, contract_no = ?, contract_name = ?, client_id = ?,
      signed_date = ?, effective_date = ?, expiry_date = ?,
      currency = ?, status = ?, note = ?, updated_at = ?
     WHERE contract_id = ?`
  ).bind(
    row.rfq_id, row.contract_no, row.contract_name, row.client_id,
    row.signed_date, row.effective_date, row.expiry_date,
    row.currency, row.status, row.note, row.updated_at,
    row.contract_id
  ).run();
}

export async function archiveContractSQL(db, contractId, archivedAt) {
  return db.prepare(
    `UPDATE contracts SET status = 'archived', archived_at = ?, updated_at = ? WHERE contract_id = ?`
  ).bind(archivedAt, archivedAt, contractId).run();
}

export async function insertContractItemSQL(db, row) {
  return db.prepare(
    `INSERT INTO contract_items (
      contract_item_id, contract_id, rfq_item_id, item_id, line_no,
      ma_vat_tu, ten_vat_tu, required_model, manufacturer, brand,
      origin_country, unit, contract_quantity, contract_unit_price, contract_line_total,
      supplier_id, supplier_name, source_quote_id, status, note,
      created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.contract_item_id, row.contract_id, row.rfq_item_id, row.item_id, row.line_no,
    row.ma_vat_tu, row.ten_vat_tu, row.required_model, row.manufacturer, row.brand,
    row.origin_country, row.unit, row.contract_quantity, row.contract_unit_price, row.contract_line_total,
    row.supplier_id, row.supplier_name, row.source_quote_id, row.status, row.note,
    row.created_at, row.updated_at, row.archived_at
  ).run();
}

export async function getContractItemSQL(db, contractItemId) {
  return db.prepare('SELECT * FROM contract_items WHERE contract_item_id = ?').bind(contractItemId).first();
}

export async function updateContractItemSQL(db, row) {
  return db.prepare(
    `UPDATE contract_items SET
      line_no = ?, ma_vat_tu = ?, ten_vat_tu = ?, required_model = ?,
      manufacturer = ?, brand = ?, origin_country = ?, unit = ?,
      contract_quantity = ?, contract_unit_price = ?, contract_line_total = ?,
      supplier_id = ?, supplier_name = ?, source_quote_id = ?, note = ?, updated_at = ?
     WHERE contract_item_id = ?`
  ).bind(
    row.line_no, row.ma_vat_tu, row.ten_vat_tu, row.required_model,
    row.manufacturer, row.brand, row.origin_country, row.unit,
    row.contract_quantity, row.contract_unit_price, row.contract_line_total,
    row.supplier_id, row.supplier_name, row.source_quote_id, row.note, row.updated_at,
    row.contract_item_id
  ).run();
}

export async function archiveContractItemSQL(db, contractItemId, archivedAt) {
  return db.prepare(
    `UPDATE contract_items SET status = 'archived', archived_at = ?, updated_at = ? WHERE contract_item_id = ?`
  ).bind(archivedAt, archivedAt, contractItemId).run();
}

// Recalculate contract_total from active items and persist.
export async function recalcContractTotalSQL(db, contractId, now) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(contract_line_total), 0) AS total
     FROM contract_items WHERE contract_id = ? AND status = 'active'`
  ).bind(contractId).first();
  const total = row?.total || 0;
  await db.prepare(
    `UPDATE contracts SET contract_total = ?, updated_at = ? WHERE contract_id = ?`
  ).bind(total, now, contractId).run();
  return total;
}
