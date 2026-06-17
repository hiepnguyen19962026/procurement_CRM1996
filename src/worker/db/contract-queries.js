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
            c.rfq_id AS contract_rfq_id,
            COALESCE(c.original_contract_total, c.contract_total, 0) AS original_contract_total
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
      original_contract_total, status, note, party_a, party_b, created_by, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.contract_id, row.rfq_id, row.contract_no, row.contract_name, row.client_id,
    row.signed_date, row.effective_date, row.expiry_date, row.currency, row.contract_total,
    row.contract_total, row.status, row.note, row.party_a || null, row.party_b || null,
    row.created_by, row.created_at, row.updated_at, row.archived_at
  ).run();
}

export async function updateContractSQL(db, row) {
  return db.prepare(
    `UPDATE contracts SET
      rfq_id = ?, contract_no = ?, contract_name = ?, client_id = ?,
      signed_date = ?, effective_date = ?, expiry_date = ?,
      currency = ?, status = ?, note = ?, party_a = ?, party_b = ?, updated_at = ?
     WHERE contract_id = ?`
  ).bind(
    row.rfq_id, row.contract_no, row.contract_name, row.client_id,
    row.signed_date, row.effective_date, row.expiry_date,
    row.currency, row.status, row.note, row.party_a || null, row.party_b || null, row.updated_at,
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
      delivery_lead_days, delivery_trigger_type, delivery_trigger_date, delivery_deadline_date,
      supplier_id, supplier_name, source_quote_id, status, note,
      created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.contract_item_id, row.contract_id, row.rfq_item_id, row.item_id, row.line_no,
    row.ma_vat_tu, row.ten_vat_tu, row.required_model, row.manufacturer, row.brand,
    row.origin_country, row.unit, row.contract_quantity, row.contract_unit_price, row.contract_line_total,
    row.delivery_lead_days, row.delivery_trigger_type, row.delivery_trigger_date, row.delivery_deadline_date,
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
      delivery_lead_days = ?, delivery_trigger_type = ?, delivery_trigger_date = ?, delivery_deadline_date = ?,
      supplier_id = ?, supplier_name = ?, source_quote_id = ?, note = ?, updated_at = ?
     WHERE contract_item_id = ?`
  ).bind(
    row.line_no, row.ma_vat_tu, row.ten_vat_tu, row.required_model,
    row.manufacturer, row.brand, row.origin_country, row.unit,
    row.contract_quantity, row.contract_unit_price, row.contract_line_total,
    row.delivery_lead_days, row.delivery_trigger_type, row.delivery_trigger_date, row.delivery_deadline_date,
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

export async function listContractAddendumsSQL(db, contractId) {
  const res = await db.prepare(
    `SELECT *
     FROM contract_addendums
     WHERE contract_id = ?
     ORDER BY COALESCE(signed_date, created_at) DESC, created_at DESC, addendum_id DESC`
  ).bind(contractId).all();
  return res.results || [];
}

export async function getContractAddendumSQL(db, addendumId) {
  return db.prepare('SELECT * FROM contract_addendums WHERE addendum_id = ?').bind(addendumId).first();
}

export async function getContractAddendumSummarySQL(db, contractId) {
  const row = await db.prepare(
    `SELECT
       COALESCE(c.original_contract_total, c.contract_total, 0) AS original_contract_total,
       COALESCE(SUM(CASE WHEN ca.status = 'active' THEN ca.amount_delta ELSE 0 END), 0) AS addendum_total,
       COALESCE(SUM(CASE WHEN ca.status = 'active' THEN 1 ELSE 0 END), 0) AS active_addendum_count
     FROM contracts c
     LEFT JOIN contract_addendums ca ON ca.contract_id = c.contract_id
     WHERE c.contract_id = ?
     GROUP BY c.contract_id`
  ).bind(contractId).first();
  const original = row?.original_contract_total || 0;
  const addendumTotal = row?.addendum_total || 0;
  return {
    original_contract_total: original,
    addendum_total: addendumTotal,
    current_effective_value: original + addendumTotal,
    active_addendum_count: row?.active_addendum_count || 0,
  };
}

export async function insertContractAddendumSQL(db, row) {
  return db.prepare(
    `INSERT INTO contract_addendums (
      addendum_id, contract_id, addendum_no, addendum_name, signed_date,
      value_before_tax, tax_rate, value_after_tax, amount_delta,
      note, external_url, status, created_by, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.addendum_id, row.contract_id, row.addendum_no, row.addendum_name, row.signed_date,
    row.value_before_tax, row.tax_rate, row.value_after_tax, row.amount_delta,
    row.note, row.external_url, row.status, row.created_by, row.created_at, row.updated_at, row.archived_at
  ).run();
}

export async function updateContractAddendumSQL(db, row) {
  return db.prepare(
    `UPDATE contract_addendums SET
      addendum_no = ?, addendum_name = ?, signed_date = ?,
      value_before_tax = ?, tax_rate = ?, value_after_tax = ?, amount_delta = ?,
      note = ?, external_url = ?, status = ?, updated_at = ?
     WHERE addendum_id = ?`
  ).bind(
    row.addendum_no, row.addendum_name, row.signed_date,
    row.value_before_tax, row.tax_rate, row.value_after_tax, row.amount_delta,
    row.note, row.external_url, row.status, row.updated_at,
    row.addendum_id
  ).run();
}

export async function archiveContractAddendumSQL(db, addendumId, archivedAt) {
  return db.prepare(
    `UPDATE contract_addendums
     SET status = 'archived', archived_at = ?, updated_at = ?
     WHERE addendum_id = ?`
  ).bind(archivedAt, archivedAt, addendumId).run();
}

export async function getContractAddendumItemsSQL(db, addendumId) {
  const res = await db.prepare(
    `SELECT *
     FROM contract_addendum_items
     WHERE addendum_id = ?
     ORDER BY created_at ASC, addendum_item_id ASC`
  ).bind(addendumId).all();
  return res.results || [];
}

export async function searchContractAddendumItemsSQL(db, params) {
  const { q, q2, q3, rfqId, limit } = params;
  const conds = ["cai.status = 'active'"];
  const binds = [];
  const searchCols = [
    'cai.item_name',
    'cai.item_code',
    'cai.spec',
    'cai.note',
    'r.ma_goi_tbmt',
    'r.ten_goi',
    'c.contract_no',
    'ca.addendum_no',
  ];
  const searchExpr = searchCols.map(normalizeSqlText).join(" || ' ' || ");
  const tokens = [q, q2, q3]
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .map(function (token) { return token.trim(); })
    .filter(Boolean)
    .slice(0, 20);
  tokens.forEach(function (token) {
    conds.push(`(${searchExpr}) LIKE ?`);
    binds.push('%' + token + '%');
  });
  if (rfqId) {
    conds.push('c.rfq_id = ?');
    binds.push(rfqId);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const res = await db.prepare(
    `SELECT
       'addendum_item' AS source_type,
       cai.addendum_item_id,
       c.rfq_id,
       r.ma_goi_tbmt,
       r.ten_goi,
       cai.contract_id,
       c.contract_no,
       cai.addendum_id,
       ca.addendum_no,
       cai.item_type,
       cai.item_code,
       cai.item_name,
       cai.spec,
       cai.unit,
       cai.quantity,
       cai.unit_price,
       cai.line_total,
       cai.tax_rate,
       cai.note
     FROM contract_addendum_items cai
     JOIN contract_addendums ca ON ca.addendum_id = cai.addendum_id
     JOIN contracts c ON c.contract_id = cai.contract_id
     LEFT JOIN rfqs r ON r.rfq_id = c.rfq_id
     ${where}
     ORDER BY COALESCE(ca.signed_date, ca.created_at) DESC, cai.created_at DESC, cai.addendum_item_id DESC
     LIMIT ?`
  ).bind(...binds, limit).all();
  return res.results || [];
}

function normalizeSqlText(col) {
  let expr = `lower(COALESCE(${col}, ''))`;
  const pairs = [
    ['áàảãạăắằẳẵặâấầẩẫậÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬ', 'a'],
    ['éèẻẽẹêếềểễệÉÈẺẼẸÊẾỀỂỄỆ', 'e'],
    ['íìỉĩịÍÌỈĨỊ', 'i'],
    ['óòỏõọôốồổỗộơớờởỡợÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢ', 'o'],
    ['úùủũụưứừửữựÚÙỦŨỤƯỨỪỬỮỰ', 'u'],
    ['ýỳỷỹỵÝỲỶỸỴ', 'y'],
    ['đĐ', 'd'],
  ];
  for (const [chars, replacement] of pairs) {
    for (const ch of chars) expr = `replace(${expr}, '${ch}', '${replacement}')`;
  }
  return expr;
}

export async function getContractAddendumItemSQL(db, addendumItemId) {
  return db.prepare('SELECT * FROM contract_addendum_items WHERE addendum_item_id = ?')
    .bind(addendumItemId).first();
}

export async function insertContractAddendumItemSQL(db, row) {
  return db.prepare(
    `INSERT INTO contract_addendum_items (
      addendum_item_id, addendum_id, contract_id, rfq_item_id,
      item_type, item_code, item_name, spec, unit,
      quantity, unit_price, line_total, tax_rate, note,
      status, created_by, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.addendum_item_id, row.addendum_id, row.contract_id, row.rfq_item_id,
    row.item_type, row.item_code, row.item_name, row.spec, row.unit,
    row.quantity, row.unit_price, row.line_total, row.tax_rate, row.note,
    row.status, row.created_by, row.created_at, row.updated_at, row.archived_at
  ).run();
}

export async function updateContractAddendumItemSQL(db, row) {
  return db.prepare(
    `UPDATE contract_addendum_items SET
      rfq_item_id = ?, item_type = ?, item_code = ?, item_name = ?,
      spec = ?, unit = ?, quantity = ?, unit_price = ?, line_total = ?,
      tax_rate = ?, note = ?, updated_at = ?
     WHERE addendum_item_id = ?`
  ).bind(
    row.rfq_item_id, row.item_type, row.item_code, row.item_name,
    row.spec, row.unit, row.quantity, row.unit_price, row.line_total,
    row.tax_rate, row.note, row.updated_at,
    row.addendum_item_id
  ).run();
}

export async function archiveContractAddendumItemSQL(db, addendumItemId, now) {
  return db.prepare(
    `UPDATE contract_addendum_items
     SET status = 'archived', archived_at = ?, updated_at = ?
     WHERE addendum_item_id = ?`
  ).bind(now, now, addendumItemId).run();
}

export async function getContractAddendumItemSummarySQL(db, addendumId) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status = 'active' THEN line_total ELSE 0 END), 0) AS detail_total
     FROM contract_addendum_items
     WHERE addendum_id = ?`
  ).bind(addendumId).first();
  return { detail_total: row?.detail_total || 0 };
}
