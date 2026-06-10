export async function listSupplierQuotesSQL(db, rfqItemId) {
  const res = await db.prepare(
    `SELECT * FROM supplier_quotes
     WHERE rfq_item_id = ?
     ORDER BY created_at ASC`
  ).bind(rfqItemId).all();
  return res.results || [];
}

export async function getSupplierQuoteSQL(db, quoteId) {
  return db.prepare(
    `SELECT * FROM supplier_quotes WHERE quote_id = ?`
  ).bind(quoteId).first();
}

export async function insertSupplierQuoteSQL(db, row) {
  return db.prepare(
    `INSERT INTO supplier_quotes (
      quote_id, rfq_item_id, supplier_id, supplier_name, manufacturer, quote_date,
      quoted_price, currency, exchange_rate, price_vnd, tax_rate, price_vnd_incl_tax,
      lead_time, valid_until, warranty, note, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.quote_id, row.rfq_item_id, row.supplier_id, row.supplier_name, row.manufacturer, row.quote_date,
    row.quoted_price, row.currency, row.exchange_rate, row.price_vnd, row.tax_rate, row.price_vnd_incl_tax,
    row.lead_time, row.valid_until, row.warranty, row.note, row.status, row.created_by, row.created_at, row.updated_at
  ).run();
}

export async function updateSupplierQuoteSQL(db, row) {
  return db.prepare(
    `UPDATE supplier_quotes SET
      supplier_id = ?, supplier_name = ?, manufacturer = ?, quote_date = ?,
      quoted_price = ?, currency = ?, exchange_rate = ?, price_vnd = ?, tax_rate = ?,
      price_vnd_incl_tax = ?, lead_time = ?, valid_until = ?, warranty = ?, note = ?,
      updated_at = ?
     WHERE quote_id = ? AND status = 'active'`
  ).bind(
    row.supplier_id, row.supplier_name, row.manufacturer, row.quote_date,
    row.quoted_price, row.currency, row.exchange_rate, row.price_vnd, row.tax_rate,
    row.price_vnd_incl_tax, row.lead_time, row.valid_until, row.warranty, row.note,
    row.updated_at, row.quote_id
  ).run();
}

export async function archiveSupplierQuoteSQL(db, { quoteId, updatedAt }) {
  return db.prepare(
    `UPDATE supplier_quotes SET status = 'archived', updated_at = ?
     WHERE quote_id = ? AND status = 'active'`
  ).bind(updatedAt, quoteId).run();
}
