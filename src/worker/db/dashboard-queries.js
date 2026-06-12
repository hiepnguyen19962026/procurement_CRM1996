// VN timezone helpers (UTC+7). Cloudflare Workers run in UTC; adding 7h offset gives correct VN date.
function todayVN() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
function vnDateAdd(days) {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000 + days * 86400000);
  return d.toISOString().slice(0, 10);
}

// All statements fire in one Promise.all (D1 supports parallel reads).
// Original 23 statements kept for backward compat; 15 new statements added for Command Center.
export async function getDashboardV2SQL(db) {
  const today    = todayVN();
  const d3       = vnDateAdd(3);
  const d7       = vnDateAdd(7);
  const tomorrow = vnDateAdd(1);
  const ago7     = vnDateAdd(-7);
  const ago30    = vnDateAdd(-30);

  const [
    // ── original 0-22 ──────────────────────────────────────────────────────────
    rfqTotal, rfqOpen, rfqDueSoon, rfqOverdue,
    itemTotal, itemsWithQuotes, itemsWithMaster,
    quoteTotal, quoteLast7, quoteLast30,
    contractActive, contractLast30, contractValue,
    masterTotal, clarPending, importErrSum,
    newestRfqs, quotesByChannel, topSuppliers,
    latestClar, latestJobs, latestContracts, topMaster,

    // ── new 23-37 ──────────────────────────────────────────────────────────────
    rfqDkqTotal, rfqDkqDue3, rfqDkqOverdue,
    rfqTrungCount, rfqTrungValue, rfqTrungItemCount,
    rfqThamKhaoCount, rfqThamKhaoValue,
    clarByStatus,
    trackedList, wonList, clarLatest30,
    taskSummaryRow, topTasks, followupList,
  ] = await Promise.all([

    // ── RFQ counts (0-3) ──────────────────────────────────────────────────────
    db.prepare('SELECT COUNT(*) AS n FROM rfqs').first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi IN ('dang_khao_gia','treo')"
    ).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi IN ('dang_khao_gia','treo')" +
      " AND ngay_het_han >= ? AND ngay_het_han <= ? AND ngay_het_han != ''"
    ).bind(today, d7).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi IN ('dang_khao_gia','treo')" +
      " AND ngay_het_han < ? AND ngay_het_han != ''"
    ).bind(today).first(),

    // ── Item counts (4-6) ─────────────────────────────────────────────────────
    db.prepare('SELECT COUNT(*) AS n FROM rfq_items').first(),
    db.prepare(
      "SELECT COUNT(DISTINCT rfq_item_id) AS n FROM supplier_quotes WHERE status = 'active'"
    ).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfq_items WHERE item_id IS NOT NULL AND item_id != ''"
    ).first(),

    // ── Quote counts (7-9) ────────────────────────────────────────────────────
    db.prepare("SELECT COUNT(*) AS n FROM supplier_quotes WHERE status = 'active'").first(),
    db.prepare('SELECT COUNT(*) AS n FROM supplier_quotes WHERE created_at >= ?').bind(ago7).first(),
    db.prepare('SELECT COUNT(*) AS n FROM supplier_quotes WHERE created_at >= ?').bind(ago30).first(),

    // ── Contract counts/sum (10-12) ───────────────────────────────────────────
    db.prepare("SELECT COUNT(*) AS n FROM contracts WHERE status = 'active'").first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM contracts WHERE status = 'active' AND COALESCE(signed_date, created_at) >= ?"
    ).bind(ago30).first(),
    db.prepare(
      "SELECT COALESCE(SUM(contract_total), 0) AS n FROM contracts WHERE status = 'active'"
    ).first(),

    // ── Master item count (13) ────────────────────────────────────────────────
    db.prepare("SELECT COUNT(*) AS n FROM items WHERE status = 'active'").first(),

    // ── Clarification pending (14) ────────────────────────────────────────────
    db.prepare(
      "SELECT COUNT(*) AS n FROM technical_clarifications WHERE deleted_at IS NULL" +
      " AND status_after IN ('waiting_supplier','waiting_client','need_more_info')"
    ).first(),

    // ── Import error sum (15) ─────────────────────────────────────────────────
    db.prepare(
      "SELECT COALESCE(SUM(error_count), 0) AS n FROM import_jobs WHERE created_at >= ?"
    ).bind(ago30).first(),

    // ── Lists (16-22) ─────────────────────────────────────────────────────────
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
      ' FROM technical_clarifications WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5'
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
      ' FROM items i JOIN rfq_items ri ON ri.item_id = i.item_id' +
      " JOIN supplier_quotes sq ON sq.rfq_item_id = ri.rfq_item_id AND sq.status = 'active'" +
      " WHERE i.status = 'active' GROUP BY i.item_id ORDER BY quote_count DESC LIMIT 5"
    ).all(),

    // ── NEW: dang_khao_gia KPI counts (23-25) ─────────────────────────────────
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi = 'dang_khao_gia'"
    ).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi = 'dang_khao_gia'" +
      " AND ngay_het_han IS NOT NULL AND ngay_het_han != ''" +
      " AND ngay_het_han >= ? AND ngay_het_han <= ?"
    ).bind(today, d3).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi = 'dang_khao_gia'" +
      " AND ngay_het_han IS NOT NULL AND ngay_het_han != '' AND ngay_het_han < ?"
    ).bind(today).first(),

    // ── NEW: trung KPI counts (26-28) ─────────────────────────────────────────
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi = 'trung'"
    ).first(),
    db.prepare(
      "SELECT COALESCE(SUM(du_toan), 0) AS n FROM rfqs WHERE trang_thai_goi = 'trung'"
    ).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfq_items i" +
      " WHERE EXISTS (SELECT 1 FROM rfqs r WHERE r.rfq_id = i.rfq_id AND r.trang_thai_goi = 'trung')"
    ).first(),

    // ── NEW: tham_khao KPI counts (29-30) ─────────────────────────────────────
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi = 'tham_khao'"
    ).first(),
    db.prepare(
      "SELECT COALESCE(SUM(du_toan), 0) AS n FROM rfqs WHERE trang_thai_goi = 'tham_khao'"
    ).first(),

    // ── NEW: clarification breakdown by status (31) ───────────────────────────
    db.prepare(
      'SELECT' +
      " SUM(CASE WHEN status_after='waiting_supplier' THEN 1 ELSE 0 END) AS waiting_supplier," +
      " SUM(CASE WHEN status_after='waiting_client'   THEN 1 ELSE 0 END) AS waiting_client," +
      " SUM(CASE WHEN status_after='need_more_info'   THEN 1 ELSE 0 END) AS need_more_info," +
      " SUM(CASE WHEN status_after='processing'       THEN 1 ELSE 0 END) AS processing" +
      ' FROM technical_clarifications WHERE deleted_at IS NULL' +
      " AND status_after IN ('waiting_supplier','waiting_client','need_more_info','processing')"
    ).first(),

    // ── NEW: tracked RFQ list – dang_khao_gia + tham_khao + da_bao, top 30 (32) ──
    db.prepare(
      'SELECT r.rfq_id, r.ma_goi_tbmt, r.ten_goi, r.ngay_het_han, r.trang_thai_goi, r.du_toan,' +
      " COALESCE(c.client_name, r.nha_may_cdt, '') AS cdt_label" +
      ' FROM rfqs r LEFT JOIN clients c ON c.client_id = r.client_id' +
      " WHERE r.trang_thai_goi IN ('dang_khao_gia','tham_khao','da_bao')" +
      ' ORDER BY' +
      " CASE WHEN r.ngay_het_han IS NULL OR r.ngay_het_han = '' THEN 2" +
      '      WHEN r.ngay_het_han >= ? THEN 0 ELSE 1 END ASC,' +
      " CASE WHEN r.ngay_het_han >= ? THEN r.ngay_het_han ELSE '0' END ASC," +
      " CASE WHEN r.ngay_het_han < ? AND r.ngay_het_han IS NOT NULL AND r.ngay_het_han != '' THEN r.ngay_het_han ELSE '9' END DESC" +
      ' LIMIT 30'
    ).bind(today, today, today).all(),

    // ── NEW: won RFQ list with item count, sorted by updated_at DESC (33) ─────
    db.prepare(
      'SELECT r.rfq_id, r.ma_goi_tbmt, r.ten_goi, r.du_toan, r.updated_at,' +
      ' (SELECT COUNT(*) FROM rfq_items i WHERE i.rfq_id = r.rfq_id) AS item_count' +
      " FROM rfqs r WHERE r.trang_thai_goi = 'trung'" +
      ' ORDER BY r.updated_at DESC, r.rfq_id DESC LIMIT 15'
    ).all(),

    // ── NEW: latest 30 clarifications with rfq_item + rfq names, exclude SMOKE (34) ──
    db.prepare(
      'SELECT tc.clarification_id, tc.rfq_item_id, tc.clarification_type, tc.status_after,' +
      ' tc.title, tc.proposed_model, tc.proposed_manufacturer, tc.proposed_origin, tc.created_at,' +
      ' i.ten_vat_tu, i.ma_vat_tu, r.rfq_id, r.ten_goi, r.ma_goi_tbmt' +
      ' FROM technical_clarifications tc' +
      ' JOIN rfq_items i ON i.rfq_item_id = tc.rfq_item_id' +
      ' JOIN rfqs r ON r.rfq_id = i.rfq_id' +
      ' WHERE tc.deleted_at IS NULL' +
      " AND UPPER(r.rfq_id) NOT LIKE '%SMOKE%'" +
      " AND UPPER(COALESCE(r.ten_goi,'')) NOT LIKE '%SMOKE%'" +
      ' ORDER BY tc.created_at DESC LIMIT 30'
    ).all(),

    // ── NEW: task summary inline (35) ─────────────────────────────────────────
    db.prepare(
      'SELECT' +
      " SUM(CASE WHEN status='dang_lam'     THEN 1 ELSE 0 END) AS dang_lam," +
      " SUM(CASE WHEN status='cho_phan_hoi' THEN 1 ELSE 0 END) AS cho_phan_hoi," +
      ' SUM(CASE WHEN deadline_date IS NOT NULL AND deadline_date < ?' +
      "          AND status NOT IN ('hoan_thanh','huy_bo') THEN 1 ELSE 0 END) AS qua_han," +
      ' SUM(CASE WHEN deadline_date IS NOT NULL AND deadline_date >= ? AND deadline_date <= ?' +
      "          AND status NOT IN ('hoan_thanh','huy_bo') THEN 1 ELSE 0 END) AS sap_den_han" +
      ' FROM tasks WHERE deleted_at IS NULL'
    ).bind(today, today, d7).first(),

    // ── NEW: top 20 active tasks sorted by urgency/priority (36) ─────────────
    db.prepare(
      'SELECT task_id, title, company_name, deadline_date, next_followup_date, status, priority, latest_note' +
      " FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('hoan_thanh','huy_bo')" +
      ' ORDER BY' +
      ' CASE WHEN deadline_date IS NOT NULL AND deadline_date < ? THEN 0 ELSE 1 END ASC,' +
      " CASE priority WHEN 'khan' THEN 0 WHEN 'cao' THEN 1 WHEN 'trung_binh' THEN 2 ELSE 3 END ASC," +
      " COALESCE(deadline_date,'9999') ASC," +
      ' COALESCE(last_activity_at,created_at) DESC' +
      ' LIMIT 20'
    ).bind(today).all(),

    // ── NEW: follow-up tasks — deadline within next 7 days (incl. overdue) (37) ──
    db.prepare(
      'SELECT task_id, title, company_name, deadline_date, next_followup_date, status, priority, latest_note, created_by' +
      " FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('hoan_thanh','huy_bo')" +
      " AND deadline_date IS NOT NULL AND deadline_date != '' AND deadline_date <= ?" +
      ' ORDER BY deadline_date ASC, task_id ASC LIMIT 20'
    ).bind(d7).all(),
  ]);

  const scalar = (row) => row?.n || 0;
  const list   = (res)  => res?.results || [];

  const iTotal  = scalar(itemTotal);
  const iQuotes = scalar(itemsWithQuotes);
  const iMaster = scalar(itemsWithMaster);

  return {
    rfq: {
      // original fields kept for compat
      total:    scalar(rfqTotal),
      open:     scalar(rfqOpen),
      due_soon: scalar(rfqDueSoon),
      overdue:  scalar(rfqOverdue),
      newest:   list(newestRfqs),
      // new command-center fields
      dkq_total:        scalar(rfqDkqTotal),
      dkq_due3:         scalar(rfqDkqDue3),
      dkq_overdue:      scalar(rfqDkqOverdue),
      trung_count:      scalar(rfqTrungCount),
      trung_value:      scalar(rfqTrungValue),
      trung_item_count: scalar(rfqTrungItemCount),
      tham_khao_count:  scalar(rfqThamKhaoCount),
      tham_khao_value:  scalar(rfqThamKhaoValue),
      tracked_list:     list(trackedList),
      won_list:         list(wonList),
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
      // original field kept
      pending: scalar(clarPending),
      latest:  list(latestClar),
      // new breakdown
      by_status: {
        waiting_supplier: Number(clarByStatus?.waiting_supplier || 0),
        waiting_client:   Number(clarByStatus?.waiting_client   || 0),
        need_more_info:   Number(clarByStatus?.need_more_info   || 0),
        processing:       Number(clarByStatus?.processing       || 0),
      },
      latest30: list(clarLatest30),
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
    tasks: {
      summary: {
        dang_lam:     Number(taskSummaryRow?.dang_lam     || 0),
        cho_phan_hoi: Number(taskSummaryRow?.cho_phan_hoi || 0),
        qua_han:      Number(taskSummaryRow?.qua_han      || 0),
        sap_den_han:  Number(taskSummaryRow?.sap_den_han  || 0),
      },
      top20:    list(topTasks),
      followup: list(followupList),
    },
  };
}
