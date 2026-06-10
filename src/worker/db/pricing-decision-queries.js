export async function listPricingDecisionsSQL(db, rfqItemId) {
  const res = await db.prepare(
    `SELECT pd.*,
            sq.supplier_name AS supplier_name,
            sq.manufacturer  AS manufacturer,
            sq.status        AS quote_status
     FROM pricing_decisions pd
     LEFT JOIN supplier_quotes sq ON sq.quote_id = pd.base_quote_id
     WHERE pd.rfq_item_id = ?
     ORDER BY pd.version DESC`
  ).bind(rfqItemId).all();
  return res.results || [];
}

export async function getNextPricingVersionSQL(db, rfqItemId) {
  const row = await db.prepare(
    `SELECT MAX(version) AS max_version FROM pricing_decisions WHERE rfq_item_id = ?`
  ).bind(rfqItemId).first();
  return ((row && row.max_version) ? Number(row.max_version) : 0) + 1;
}

export async function insertPricingDecisionSQL(db, row) {
  return db.prepare(
    `INSERT INTO pricing_decisions (
      pricing_id, rfq_item_id, base_quote_id,
      base_price_vnd_incl_tax, markup_rate, selection_reason,
      risk_level, risk_note,
      proposed_unit_price, proposed_line_total,
      pricing_note, version, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.pricing_id, row.rfq_item_id, row.base_quote_id,
    row.base_price_vnd_incl_tax, row.markup_rate, row.selection_reason,
    row.risk_level, row.risk_note,
    row.proposed_unit_price, row.proposed_line_total,
    row.pricing_note, row.version, row.created_by, row.created_at
  ).run();
}
