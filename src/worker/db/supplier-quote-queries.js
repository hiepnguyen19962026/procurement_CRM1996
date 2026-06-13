const SQ_SORT = {
  created_at:    { col: 'sq.created_at',        rowKey: 'created_at',        type: 'text' },
  supplier_name: { col: 'sq.supplier_name',      rowKey: 'supplier_name',     type: 'text' },
  manufacturer:  { col: 'sq.manufacturer',       rowKey: 'manufacturer',      type: 'text' },
  price:         { col: 'sq.price_vnd_incl_tax', rowKey: 'price_vnd_incl_tax',type: 'num'  },
  valid_until:   { col: 'sq.valid_until',        rowKey: 'valid_until',       type: 'text' },
  quote_date:    { col: 'sq.quote_date',         rowKey: 'quote_date',        type: 'text' },
};

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
      lead_time, valid_until, warranty, note, source_channel, source_ref, received_at,
      status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.quote_id, row.rfq_item_id, row.supplier_id, row.supplier_name, row.manufacturer, row.quote_date,
    row.quoted_price, row.currency, row.exchange_rate, row.price_vnd, row.tax_rate, row.price_vnd_incl_tax,
    row.lead_time, row.valid_until, row.warranty, row.note, row.source_channel, row.source_ref, row.received_at,
    row.status, row.created_by, row.created_at, row.updated_at
  ).run();
}

export async function updateSupplierQuoteSQL(db, row) {
  return db.prepare(
    `UPDATE supplier_quotes SET
      supplier_id = ?, supplier_name = ?, manufacturer = ?, quote_date = ?,
      quoted_price = ?, currency = ?, exchange_rate = ?, price_vnd = ?, tax_rate = ?,
      price_vnd_incl_tax = ?, lead_time = ?, valid_until = ?, warranty = ?, note = ?,
      source_channel = ?, source_ref = ?, received_at = ?, updated_at = ?
     WHERE quote_id = ? AND status = 'active'`
  ).bind(
    row.supplier_id, row.supplier_name, row.manufacturer, row.quote_date,
    row.quoted_price, row.currency, row.exchange_rate, row.price_vnd, row.tax_rate,
    row.price_vnd_incl_tax, row.lead_time, row.valid_until, row.warranty, row.note,
    row.source_channel, row.source_ref, row.received_at, row.updated_at, row.quote_id
  ).run();
}

export async function archiveSupplierQuoteSQL(db, { quoteId, updatedAt }) {
  return db.prepare(
    `UPDATE supplier_quotes SET status = 'archived', updated_at = ?
     WHERE quote_id = ? AND status = 'active'`
  ).bind(updatedAt, quoteId).run();
}

export async function deleteSupplierQuoteSQL(db, quoteId) {
  return db.prepare(
    `DELETE FROM supplier_quotes WHERE quote_id = ?`
  ).bind(quoteId).run();
}

// Report active quotes whose valid_until has passed. Read-only — no mutation.
export async function getExpiredQuotesReportSQL(db, today) {
  const [countRow, samplesRes] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS n FROM supplier_quotes
       WHERE status = 'active'
         AND valid_until IS NOT NULL AND valid_until != ''
         AND valid_until < ?`
    ).bind(today).first(),
    db.prepare(
      `SELECT quote_id, rfq_item_id, supplier_name, valid_until
       FROM supplier_quotes
       WHERE status = 'active'
         AND valid_until IS NOT NULL AND valid_until != ''
         AND valid_until < ?
       ORDER BY valid_until ASC LIMIT 10`
    ).bind(today).all(),
  ]);
  return { count: countRow?.n || 0, samples: samplesRes.results || [] };
}

export async function searchSupplierQuotesSQL(db, params) {
  const {
    q, supplierName, manufacturer, status, sourceChannel,
    priceMin, priceMax, validUntilFrom, validUntilTo,
    rfqId, rfqItemId, sortBy, sortDir,
    cursorSortVal, cursorQuoteId, limit,
  } = params;

  const sort = SQ_SORT[sortBy] || SQ_SORT.created_at;
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const op  = dir === 'ASC' ? '>' : '<';

  const conds = [];
  const binds = [];

  if (rfqItemId) { conds.push('sq.rfq_item_id = ?'); binds.push(rfqItemId); }
  if (rfqId)     { conds.push('i.rfq_id = ?');        binds.push(rfqId); }
  if (status)    { conds.push('sq.status = ?');        binds.push(status); }
  if (sourceChannel) { conds.push('sq.source_channel = ?'); binds.push(sourceChannel); }
  if (supplierName) { conds.push('sq.supplier_name LIKE ?'); binds.push('%' + supplierName + '%'); }
  if (manufacturer) { conds.push('sq.manufacturer LIKE ?');  binds.push('%' + manufacturer + '%'); }
  if (priceMin !== null && priceMin !== undefined) { conds.push('sq.price_vnd_incl_tax >= ?'); binds.push(priceMin); }
  if (priceMax !== null && priceMax !== undefined) { conds.push('sq.price_vnd_incl_tax <= ?'); binds.push(priceMax); }
  if (validUntilFrom) { conds.push('sq.valid_until >= ?'); binds.push(validUntilFrom); }
  if (validUntilTo)   { conds.push('sq.valid_until <= ?'); binds.push(validUntilTo); }
  if (q) {
    const like = '%' + q + '%';
    conds.push('(sq.supplier_name LIKE ? OR sq.manufacturer LIKE ? OR sq.source_ref LIKE ? OR i.ten_vat_tu LIKE ? OR i.ma_vat_tu LIKE ? OR i.required_model LIKE ? OR i.quy_cach_model_yeu_cau LIKE ? OR r.ma_goi_tbmt LIKE ? OR r.ten_goi LIKE ?)');
    binds.push(like, like, like, like, like, like, like, like, like);
  }

  // Keyset cursor using |||
  if (cursorSortVal !== null && cursorSortVal !== undefined && cursorQuoteId) {
    if (sort.type === 'num') {
      const sv = Number(cursorSortVal);
      conds.push(`(COALESCE(${sort.col}, 0) ${op} ? OR (COALESCE(${sort.col}, 0) = ? AND sq.quote_id ${op} ?))`);
      binds.push(sv, sv, cursorQuoteId);
    } else {
      const sv = cursorSortVal;
      conds.push(`(COALESCE(${sort.col}, '') ${op} ? OR (COALESCE(${sort.col}, '') = ? AND sq.quote_id ${op} ?))`);
      binds.push(sv, sv, cursorQuoteId);
    }
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const orderBy = `${sort.col} ${dir}, sq.quote_id ${dir}`;
  const sql = `
    SELECT
      sq.quote_id, sq.rfq_item_id, sq.supplier_id, sq.supplier_name, sq.manufacturer,
      sq.quote_date, sq.quoted_price, sq.currency, sq.exchange_rate, sq.price_vnd,
      sq.tax_rate, sq.price_vnd_incl_tax, sq.lead_time, sq.valid_until, sq.warranty,
      sq.note, sq.source_channel, sq.source_ref, sq.received_at,
      sq.status, sq.created_at, sq.updated_at,
      i.rfq_id, i.ma_vat_tu, i.ten_vat_tu, i.required_model, i.quy_cach_model_yeu_cau,
      COALESCE(i.required_model, i.quy_cach_model_yeu_cau) AS required_model_display,
      r.ma_goi_tbmt, r.ten_goi, r.nha_may_cdt, r.ngay_het_han, r.trang_thai_goi
    FROM supplier_quotes sq
    JOIN rfq_items i ON i.rfq_item_id = sq.rfq_item_id
    JOIN rfqs r      ON r.rfq_id = i.rfq_id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ?
  `;
  binds.push(limit);

  const res = await db.prepare(sql).bind(...binds).all();
  return { rows: res.results || [], sort, dir };
}
