// All 23 statements fire in one Promise.all (D1 supports parallel reads).
// Each helper returns the scalar n or row array from a D1Result.
export async function getDashboardV2SQL(db) {
  const today = new Date().toISOString().slice(0, 10);
  const d7    = new Date(Date.now() + 7  * 86400000).toISOString().slice(0, 10);
  const ago7  = new Date(Date.now() - 7  * 86400000).toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [
    rfqTotal, rfqOpen, rfqDueSoon, rfqOverdue,
    itemTotal, itemsWithQuotes, itemsWithMaster,
    quoteTotal, quoteLast7, quoteLast30,
    contractActive, contractLast30, contractValue,
    masterTotal, clarPending, importErrSum,
    newestRfqs, quotesByChannel, topSuppliers,
    latestClar, latestJobs, latestContracts, topMaster,
  ] = await Promise.all([
    // --- RFQ counts (0–3) ---
    db.prepare('SELECT COUNT(*) AS n FROM rfqs').first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi IN ('dang_khao_gia','treo')"
    ).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs" +
      " WHERE trang_thai_goi IN ('dang_khao_gia','treo')" +
      " AND ngay_het_han >= ? AND ngay_het_han <= ? AND ngay_het_han != ''"
    ).bind(today, d7).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs" +
      " WHERE trang_thai_goi IN ('dang_khao_gia','treo')" +
      " AND ngay_het_han < ? AND ngay_het_han != ''"
    ).bind(today).first(),

    // --- Item counts (4–6) ---
    db.prepare('SELECT COUNT(*) AS n FROM rfq_items').first(),
    db.prepare(
      "SELECT COUNT(DISTINCT rfq_item_id) AS n FROM supplier_quotes WHERE status = 'active'"
    ).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfq_items WHERE item_id IS NOT NULL AND item_id != ''"
    ).first(),

    // --- Quote counts (7–9) ---
    db.prepare("SELECT COUNT(*) AS n FROM supplier_quotes WHERE status = 'active'").first(),
    db.prepare(
      'SELECT COUNT(*) AS n FROM supplier_quotes WHERE created_at >= ?'
    ).bind(ago7).first(),
    db.prepare(
      'SELECT COUNT(*) AS n FROM supplier_quotes WHERE created_at >= ?'
    ).bind(ago30).first(),

    // --- Contract counts/sum (10–12) ---
    db.prepare("SELECT COUNT(*) AS n FROM contracts WHERE status = 'active'").first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM contracts WHERE status = 'active' AND COALESCE(signed_date, created_at) >= ?"
    ).bind(ago30).first(),
    db.prepare(
      "SELECT COALESCE(SUM(contract_total), 0) AS n FROM contracts WHERE status = 'active'"
    ).first(),

    // --- Master item count (13) ---
    db.prepare("SELECT COUNT(*) AS n FROM items WHERE status = 'active'").first(),

    // --- Clarification pending (14) ---
    db.prepare(
      "SELECT COUNT(*) AS n FROM technical_clarifications" +
      " WHERE deleted_at IS NULL" +
      " AND status_after IN ('waiting_supplier','waiting_client','need_more_info')"
    ).first(),

    // --- Import error sum (15) ---
    db.prepare(
      "SELECT COALESCE(SUM(error_count), 0) AS n FROM import_jobs WHERE created_at >= ?"
    ).bind(ago30).first(),

    // --- Lists (16–22) ---
    db.prepare(
      'SELECT rfq_id, ma_goi_tbmt, ten_goi, trang_thai_goi, ngay_het_han, created_at' +
      ' FROM rfqs ORDER BY created_at DESC, rfq_id DESC LIMIT 5'
    ).all(),
    db.prepare(
      "SELECT COALESCE(source_channel,'unknown') AS channel, COUNT(*) AS cnt" +
      " FROM supplier_quotes WHERE status = 'active'" +
      ' GROUP BY source_channel ORDER BY cnt DESC'
    ).all(),
    db.prepare(
      "SELECT supplier_name AS name, COUNT(*) AS cnt FROM supplier_quotes" +
      " WHERE status = 'active' AND supplier_name IS NOT NULL AND supplier_name != ''" +
      ' GROUP BY supplier_name ORDER BY cnt DESC LIMIT 5'
    ).all(),
    db.prepare(
      'SELECT clarification_id, title, status_after, clarification_type, created_at, rfq_item_id' +
      ' FROM technical_clarifications WHERE deleted_at IS NULL' +
      ' ORDER BY created_at DESC LIMIT 5'
    ).all(),
    db.prepare(
      'SELECT job_id, rfq_id, source_file_name, status, total_rows,' +
      ' created_count, updated_count, error_count, created_at' +
      ' FROM import_jobs ORDER BY created_at DESC LIMIT 5'
    ).all(),
    db.prepare(
      "SELECT contract_id, contract_no, contract_name, signed_date, contract_total, currency, created_at" +
      " FROM contracts WHERE status = 'active'" +
      " ORDER BY COALESCE(signed_date, created_at) DESC, contract_id DESC LIMIT 5"
    ).all(),
    db.prepare(
      'SELECT i.item_id, i.ten_vat_tu, i.ma_vat_tu, COUNT(sq.quote_id) AS quote_count' +
      ' FROM items i' +
      ' JOIN rfq_items ri ON ri.item_id = i.item_id' +
      " JOIN supplier_quotes sq ON sq.rfq_item_id = ri.rfq_item_id AND sq.status = 'active'" +
      " WHERE i.status = 'active'" +
      ' GROUP BY i.item_id' +
      ' ORDER BY quote_count DESC LIMIT 5'
    ).all(),
  ]);

  const scalar = (row) => row?.n || 0;
  const list   = (res)  => res?.results || [];

  const iTotal  = scalar(itemTotal);
  const iQuotes = scalar(itemsWithQuotes);
  const iMaster = scalar(itemsWithMaster);

  return {
    rfq: {
      total:    scalar(rfqTotal),
      open:     scalar(rfqOpen),
      due_soon: scalar(rfqDueSoon),
      overdue:  scalar(rfqOverdue),
      newest:   list(newestRfqs),
    },
    items: {
      total:              iTotal,
      with_quotes:        iQuotes,
      without_quotes:     Math.max(0, iTotal - iQuotes),
      quote_coverage_pct: iTotal > 0 ? Math.round((iQuotes / iTotal) * 100) : 0,
      with_master_link:   iMaster,
      master_link_pct:    iTotal > 0 ? Math.round((iMaster / iTotal) * 100) : 0,
    },
    quotes: {
      total:         scalar(quoteTotal),
      last_7_days:   scalar(quoteLast7),
      last_30_days:  scalar(quoteLast30),
      by_channel:    list(quotesByChannel),
      top_suppliers: list(topSuppliers),
    },
    clarifications: {
      pending: scalar(clarPending),
      latest:  list(latestClar),
    },
    imports: {
      latest_jobs:              list(latestJobs),
      error_count_last_30_days: scalar(importErrSum),
    },
    contracts: {
      active:             scalar(contractActive),
      last_30_days:       scalar(contractLast30),
      total_value_active: scalar(contractValue),
      latest:             list(latestContracts),
    },
    master_items: {
      total:              scalar(masterTotal),
      top_by_quote_count: list(topMaster),
    },
  };
}
