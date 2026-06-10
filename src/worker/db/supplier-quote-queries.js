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

export async function searchSupplierQuotesSQL(db, params) {
  const {
    q, supplierName, manufacturer, status,
    priceMin, priceMax, validUntilFrom, validUntilTo,
    rfqId, rfqItemId, cursorCreatedAt, cursorQuoteId, limit,
  } = params;

  const conds = [];
  const binds = [];

  if (rfqItemId) { conds.push('sq.rfq_item_id = ?'); binds.push(rfqItemId); }
  if (rfqId)     { conds.push('i.rfq_id = ?');        binds.push(rfqId); }
  if (status)    { conds.push('sq.status = ?');        binds.push(status); }
  if (supplierName) { conds.push('sq.supplier_name LIKE ?'); binds.push('%' + supplierName + '%'); }
  if (manufacturer) { conds.push('sq.manufacturer LIKE ?');  binds.push('%' + manufacturer + '%'); }
  if (priceMin !== null && priceMin !== undefined) { conds.push('sq.price_vnd_incl_tax >= ?'); binds.push(priceMin); }
  if (priceMax !== null && priceMax !== undefined) { conds.push('sq.price_vnd_incl_tax <= ?'); binds.push(priceMax); }
  if (validUntilFrom) { conds.push('sq.valid_until >= ?'); binds.push(validUntilFrom); }
  if (validUntilTo)   { conds.push('sq.valid_until <= ?'); binds.push(validUntilTo); }
  if (q) {
    const like = '%' + q + '%';
    conds.push('(sq.supplier_name LIKE ? OR sq.manufacturer LIKE ? OR i.ten_vat_tu LIKE ? OR i.ma_vat_tu LIKE ? OR i.required_model LIKE ? OR i.quy_cach_model_yeu_cau LIKE ? OR r.ma_goi_tbmt LIKE ? OR r.ten_goi LIKE ?)');
    binds.push(like, like, like, like, like, like, like, like);
  }
  if (cursorCreatedAt && cursorQuoteId) {
    conds.push('(sq.created_at < ? OR (sq.created_at = ? AND sq.quote_id < ?))');
    binds.push(cursorCreatedAt, cursorCreatedAt, cursorQuoteId);
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const sql = `
    SELECT
      sq.quote_id, sq.rfq_item_id, sq.supplier_id, sq.supplier_name, sq.manufacturer,
      sq.quote_date, sq.quoted_price, sq.currency, sq.exchange_rate, sq.price_vnd,
      sq.tax_rate, sq.price_vnd_incl_tax, sq.lead_time, sq.valid_until, sq.warranty,
      sq.note, sq.status, sq.created_at, sq.updated_at,
      i.rfq_id, i.ma_vat_tu, i.ten_vat_tu, i.required_model, i.quy_cach_model_yeu_cau,
      COALESCE(i.required_model, i.quy_cach_model_yeu_cau) AS required_model_display,
      r.ma_goi_tbmt, r.ten_goi, r.nha_may_cdt, r.ngay_het_han, r.trang_thai_goi
    FROM supplier_quotes sq
    JOIN rfq_items i ON i.rfq_item_id = sq.rfq_item_id
    JOIN rfqs r      ON r.rfq_id = i.rfq_id
    ${where}
    ORDER BY sq.created_at DESC, sq.quote_id DESC
    LIMIT ?
  `;
  binds.push(limit);

  const res = await db.prepare(sql).bind(...binds).all();
  return res.results || [];
}
