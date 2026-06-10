// Sort expression reused across queries — newest quote first.
const SORT_EXPR = "COALESCE(sq.received_at, sq.quote_date, sq.created_at)";

// Shared SELECT columns for all price-history queries.
const SELECT_COLS = `
  sq.quote_id, sq.rfq_item_id, i.item_id,
  it.ma_vat_tu          AS master_ma_vat_tu,
  it.ten_vat_tu         AS master_ten_vat_tu,
  it.required_model     AS master_spec,
  i.ma_vat_tu, i.ten_vat_tu,
  COALESCE(i.required_model, i.quy_cach_model_yeu_cau) AS required_model,
  i.manufacturer,
  COALESCE(i.brand, i.nhan_hieu)              AS brand,
  COALESCE(i.origin_country, i.xuat_xu)       AS origin_country,
  COALESCE(i.unit, i.don_vi)                  AS unit,
  COALESCE(i.quantity, i.so_luong)            AS quantity,
  i.rfq_id,
  r.ma_goi_tbmt, r.ten_goi, r.nha_may_cdt, r.client_id,
  sq.supplier_id, sq.supplier_name,
  sq.quote_date, sq.received_at,
  sq.source_channel, sq.source_ref,
  sq.quoted_price, sq.currency, sq.exchange_rate,
  sq.price_vnd, sq.tax_rate, sq.price_vnd_incl_tax,
  sq.lead_time, sq.valid_until, sq.warranty,
  sq.note, sq.status, sq.created_at,
  ${SORT_EXPR} AS sort_date,
  (
    SELECT COUNT(*) FROM media_files mf
    WHERE mf.owner_type = 'quote' AND mf.owner_id = sq.quote_id
  ) AS evidence_count
`.trim();

const FROM_JOINS = `
  FROM supplier_quotes sq
  JOIN rfq_items i  ON i.rfq_item_id = sq.rfq_item_id
  JOIN rfqs r       ON r.rfq_id = i.rfq_id
  LEFT JOIN items it ON it.item_id = i.item_id
`.trim();

// Build WHERE conditions from filter params.
// Returns { conds: string[], binds: any[] }
function buildFilters(p) {
  const conds = [];
  const binds = [];

  if (p.rfqItemId)    { conds.push('sq.rfq_item_id = ?');    binds.push(p.rfqItemId); }
  if (p.itemId)       { conds.push('i.item_id = ?');          binds.push(p.itemId); }
  if (p.rfqId)        { conds.push('i.rfq_id = ?');           binds.push(p.rfqId); }
  if (p.clientId)     { conds.push('r.client_id = ?');        binds.push(p.clientId); }
  if (p.supplierId)   { conds.push('sq.supplier_id = ?');     binds.push(p.supplierId); }
  if (p.supplierName) {
    conds.push('sq.supplier_name LIKE ?');
    binds.push('%' + p.supplierName + '%');
  }
  if (p.sourceChannel) {
    conds.push('sq.source_channel = ?');
    binds.push(p.sourceChannel);
  }
  if (p.maVatTu) {
    conds.push('(i.ma_vat_tu LIKE ? OR it.ma_vat_tu LIKE ?)');
    binds.push('%' + p.maVatTu + '%', '%' + p.maVatTu + '%');
  }
  if (p.dateFrom) {
    conds.push(`${SORT_EXPR} >= ?`);
    binds.push(p.dateFrom);
  }
  if (p.dateTo) {
    conds.push(`${SORT_EXPR} <= ?`);
    binds.push(p.dateTo);
  }
  if (p.q) {
    const like = '%' + p.q + '%';
    conds.push(
      '(sq.supplier_name LIKE ? OR i.ten_vat_tu LIKE ? OR i.ma_vat_tu LIKE ?' +
      ' OR COALESCE(i.required_model, i.quy_cach_model_yeu_cau) LIKE ?' +
      ' OR r.ma_goi_tbmt LIKE ? OR r.ten_goi LIKE ?' +
      ' OR it.ma_vat_tu LIKE ? OR it.ten_vat_tu LIKE ?)'
    );
    binds.push(like, like, like, like, like, like, like, like);
  }
  // Cursor: (sort_date DESC, quote_id DESC)
  if (p.cursorSortDate && p.cursorQuoteId) {
    conds.push(
      `(${SORT_EXPR} < ? OR (${SORT_EXPR} = ? AND sq.quote_id < ?))`
    );
    binds.push(p.cursorSortDate, p.cursorSortDate, p.cursorQuoteId);
  }

  return { conds, binds };
}

// Paginated list — newest first, limit+1 to detect hasMore.
export async function searchPriceHistorySQL(db, params) {
  const { conds, binds } = buildFilters(params);
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const sql = `SELECT ${SELECT_COLS} ${FROM_JOINS} ${where}
    ORDER BY sort_date DESC, sq.quote_id DESC LIMIT ?`;
  const res = await db.prepare(sql).bind(...binds, params.limit).all();
  return res.results || [];
}

// Aggregate summary + latest quote info.
export async function getPriceHistorySummarySQL(db, filters) {
  const { conds, binds } = buildFilters(filters);
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const aggSql = `
    SELECT
      COUNT(*)                                          AS total_quotes,
      COUNT(DISTINCT COALESCE(sq.supplier_id, sq.supplier_name)) AS supplier_count,
      COUNT(DISTINCT i.rfq_id)                         AS rfq_count,
      COUNT(DISTINCT sq.rfq_item_id)                   AS item_count,
      MIN(sq.price_vnd_incl_tax)                       AS min_price_vnd_incl_tax,
      MAX(sq.price_vnd_incl_tax)                       AS max_price_vnd_incl_tax,
      AVG(sq.price_vnd_incl_tax)                       AS avg_price_vnd_incl_tax
    ${FROM_JOINS} ${where}
  `;
  const latestSql = `
    SELECT
      sq.price_vnd_incl_tax AS latest_price_vnd_incl_tax,
      ${SORT_EXPR}          AS latest_quote_date,
      sq.supplier_name      AS latest_supplier_name
    ${FROM_JOINS} ${where}
    ORDER BY ${SORT_EXPR} DESC, sq.quote_id DESC
    LIMIT 1
  `;

  const [aggRes, latestRes] = await Promise.all([
    db.prepare(aggSql).bind(...binds).first(),
    db.prepare(latestSql).bind(...binds).first(),
  ]);

  return {
    total_quotes:          aggRes?.total_quotes ?? 0,
    supplier_count:        aggRes?.supplier_count ?? 0,
    rfq_count:             aggRes?.rfq_count ?? 0,
    item_count:            aggRes?.item_count ?? 0,
    min_price_vnd_incl_tax: aggRes?.min_price_vnd_incl_tax ?? null,
    max_price_vnd_incl_tax: aggRes?.max_price_vnd_incl_tax ?? null,
    avg_price_vnd_incl_tax: aggRes?.avg_price_vnd_incl_tax ?? null,
    latest_price_vnd_incl_tax: latestRes?.latest_price_vnd_incl_tax ?? null,
    latest_quote_date:     latestRes?.latest_quote_date ?? null,
    latest_supplier_name:  latestRes?.latest_supplier_name ?? null,
  };
}

// Export all matching rows — no cursor, hard limit 5000.
export async function exportPriceHistorySQL(db, filters) {
  const { conds, binds } = buildFilters(filters);
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const sql = `SELECT ${SELECT_COLS} ${FROM_JOINS} ${where}
    ORDER BY sort_date DESC, sq.quote_id DESC LIMIT ?`;
  const res = await db.prepare(sql).bind(...binds, filters.limit).all();
  return res.results || [];
}
