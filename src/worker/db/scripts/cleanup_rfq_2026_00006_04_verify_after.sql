-- ============================================================
-- FILE 4 of 4: VERIFY AFTER
-- PURPOSE : Read-only post-cleanup checks. All must pass.
--           No data is changed.
-- Run with: wrangler d1 execute <db-name> --file=...04_verify_after.sql
-- ============================================================

-- ----------------------------------------------------------
-- 4A. Total item count must be 67 (one row per item, no duplicates).
-- ----------------------------------------------------------
SELECT '4A: total items (expect 67)' AS check_label,
       COUNT(*) AS val
FROM rfq_items
WHERE rfq_id = 'RFQ-2026-00006'
  AND trang_thai_dong != 'archived';

-- ----------------------------------------------------------
-- 4B. Duplicate groups must be 0.
-- ----------------------------------------------------------
SELECT '4B: duplicate identity groups (expect 0)' AS check_label,
       COUNT(*) AS val
FROM (
  SELECT stt_goc, ma_mua_sam, ma_vat_tu
  FROM rfq_items
  WHERE rfq_id = 'RFQ-2026-00006'
    AND trang_thai_dong != 'archived'
  GROUP BY stt_goc, ma_mua_sam, ma_vat_tu
  HAVING COUNT(*) > 1
);

-- ----------------------------------------------------------
-- 4C. Undeletable conflicts — duplicate rows that still exist
--     because they had linked records (file 03 skipped them).
--     If this is > 0, investigate these rows manually.
-- ----------------------------------------------------------
SELECT '4C: undeletable conflict rows remaining (expect 0)' AS check_label,
       COUNT(*) AS val
FROM rfq_items i
WHERE i.rfq_id = 'RFQ-2026-00006'
  AND i.trang_thai_dong != 'archived'
  AND EXISTS (
    SELECT 1 FROM rfq_items i2
    WHERE i2.rfq_id      = i.rfq_id
      AND i2.stt_goc     = i.stt_goc
      AND i2.ma_mua_sam  = i.ma_mua_sam
      AND i2.ma_vat_tu   = i.ma_vat_tu
      AND i2.rfq_item_id != i.rfq_item_id
      AND i2.trang_thai_dong != 'archived'
  );

-- ----------------------------------------------------------
-- 4D. Orphaned technical_clarifications must be 0.
--     Every TC must still point to a valid rfq_item_id.
-- ----------------------------------------------------------
SELECT '4D: orphaned TC records (expect 0)' AS check_label,
       COUNT(*) AS val
FROM technical_clarifications tc
WHERE tc.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM rfq_items i WHERE i.rfq_item_id = tc.rfq_item_id
  );

-- ----------------------------------------------------------
-- 4E. TC count for this RFQ must be unchanged from before cleanup.
--     Compare to the tc_count values from file 01 check 1C.
-- ----------------------------------------------------------
SELECT '4E: TC count for RFQ-2026-00006 (compare to before)' AS check_label,
       COUNT(*) AS val
FROM technical_clarifications tc
INNER JOIN rfq_items i ON i.rfq_item_id = tc.rfq_item_id
WHERE i.rfq_id = 'RFQ-2026-00006'
  AND tc.deleted_at IS NULL;

-- ----------------------------------------------------------
-- 4F. Orphaned supplier_quotes must be 0.
-- ----------------------------------------------------------
SELECT '4F: orphaned supplier_quotes (expect 0)' AS check_label,
       COUNT(*) AS val
FROM supplier_quotes sq
WHERE NOT EXISTS (
  SELECT 1 FROM rfq_items i WHERE i.rfq_item_id = sq.rfq_item_id
);

-- ----------------------------------------------------------
-- 4G. import_job_rows with rfq_item_id pointing to a now-deleted row.
--     Expect 0 — file 03 nullified these before deleting.
-- ----------------------------------------------------------
SELECT '4G: dangling import_job_rows (expect 0)' AS check_label,
       COUNT(*) AS val
FROM import_job_rows ijr
WHERE ijr.rfq_item_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM rfq_items i WHERE i.rfq_item_id = ijr.rfq_item_id
  );

-- ----------------------------------------------------------
-- 4H. Sample: first 20 items showing corrected unit/quantity.
--     Confirm unit is text (e.g. "件", "cái") and quantity is numeric.
-- ----------------------------------------------------------
SELECT
  rfq_item_id,
  stt_goc,
  ma_vat_tu,
  ten_vat_tu,
  unit,
  don_vi,
  quantity,
  so_luong,
  updated_at
FROM rfq_items
WHERE rfq_id = 'RFQ-2026-00006'
  AND trang_thai_dong != 'archived'
ORDER BY CAST(stt_goc AS INTEGER), rfq_item_id
LIMIT 20;
