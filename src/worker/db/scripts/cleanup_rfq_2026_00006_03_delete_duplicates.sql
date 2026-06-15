-- ============================================================
-- FILE 3 of 4: DELETE DUPLICATES
-- PURPOSE : Delete newer duplicate rfq_items rows.
--           Hard guards: a row is only deleted if ALL six link
--           tables are empty for that rfq_item_id.
--           If a duplicate somehow has links it is silently skipped
--           and will appear in file 04 check 4C.
-- Prerequisite: file 02 has run and its verification SELECT
--               showed correct unit/quantity on all keeper rows.
-- Run with: wrangler d1 execute <db-name> --file=...03_delete_duplicates.sql
-- ============================================================

-- ----------------------------------------------------------
-- 3A. Pre-delete: list exact rows that WILL be deleted.
--     Run this SELECT mentally or in a separate query tool
--     to confirm you agree with the list before executing 3B.
--     (Wrangler runs the whole file — read this output carefully.)
-- ----------------------------------------------------------
SELECT
  'WILL DELETE' AS action,
  i.rfq_item_id,
  i.stt_goc,
  i.ma_vat_tu,
  i.ten_vat_tu,
  i.unit,
  i.quantity,
  i.created_at,
  (SELECT COUNT(*) FROM technical_clarifications tc
   WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL) AS tc_count,
  (SELECT COUNT(*) FROM supplier_quotes sq
   WHERE sq.rfq_item_id = i.rfq_item_id)                           AS sq_count,
  (SELECT COUNT(*) FROM pricing_decisions pd
   WHERE pd.rfq_item_id = i.rfq_item_id)                           AS pd_count,
  (SELECT COUNT(*) FROM contract_items ci
   WHERE ci.rfq_item_id = i.rfq_item_id)                           AS ci_count,
  (SELECT COUNT(*) FROM media_files mf
   WHERE mf.owner_id = i.rfq_item_id AND mf.owner_type = 'rfq_item') AS media_count,
  (SELECT COUNT(*) FROM rfq_item_revisions rev
   WHERE rev.rfq_item_id = i.rfq_item_id)                          AS rev_count,
  (SELECT COUNT(*) FROM import_job_rows ijr
   WHERE ijr.rfq_item_id = i.rfq_item_id)                          AS import_job_row_count
FROM rfq_items i
WHERE i.rfq_id = 'RFQ-2026-00006'
  AND i.trang_thai_dong != 'archived'
  -- Is the newer row in a duplicate group
  AND EXISTS (
    SELECT 1 FROM rfq_items older
    WHERE older.rfq_id     = i.rfq_id
      AND older.stt_goc    = i.stt_goc
      AND older.ma_mua_sam = i.ma_mua_sam
      AND older.ma_vat_tu  = i.ma_vat_tu
      AND older.created_at < i.created_at
      AND older.trang_thai_dong != 'archived'
  )
  -- Has zero links across all business tables
  AND NOT EXISTS (SELECT 1 FROM technical_clarifications tc
                  WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM supplier_quotes sq
                  WHERE sq.rfq_item_id = i.rfq_item_id)
  AND NOT EXISTS (SELECT 1 FROM pricing_decisions pd
                  WHERE pd.rfq_item_id = i.rfq_item_id)
  AND NOT EXISTS (SELECT 1 FROM contract_items ci
                  WHERE ci.rfq_item_id = i.rfq_item_id)
  AND NOT EXISTS (SELECT 1 FROM media_files mf
                  WHERE mf.owner_id = i.rfq_item_id AND mf.owner_type = 'rfq_item')
  AND NOT EXISTS (SELECT 1 FROM rfq_item_revisions rev
                  WHERE rev.rfq_item_id = i.rfq_item_id)
ORDER BY i.stt_goc;

-- ----------------------------------------------------------
-- 3B. Nullify import_job_rows.rfq_item_id for rows being deleted.
--     import_job_rows are audit records only — no business impact.
--     Prevents dangling references in the import audit log.
-- ----------------------------------------------------------
UPDATE import_job_rows
SET rfq_item_id = NULL
WHERE rfq_item_id IN (
  SELECT i.rfq_item_id
  FROM rfq_items i
  WHERE i.rfq_id = 'RFQ-2026-00006'
    AND i.trang_thai_dong != 'archived'
    AND EXISTS (
      SELECT 1 FROM rfq_items older
      WHERE older.rfq_id     = i.rfq_id
        AND older.stt_goc    = i.stt_goc
        AND older.ma_mua_sam = i.ma_mua_sam
        AND older.ma_vat_tu  = i.ma_vat_tu
        AND older.created_at < i.created_at
        AND older.trang_thai_dong != 'archived'
    )
    AND NOT EXISTS (SELECT 1 FROM technical_clarifications tc
                    WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM supplier_quotes sq WHERE sq.rfq_item_id = i.rfq_item_id)
    AND NOT EXISTS (SELECT 1 FROM pricing_decisions pd WHERE pd.rfq_item_id = i.rfq_item_id)
    AND NOT EXISTS (SELECT 1 FROM contract_items ci WHERE ci.rfq_item_id = i.rfq_item_id)
    AND NOT EXISTS (SELECT 1 FROM media_files mf
                    WHERE mf.owner_id = i.rfq_item_id AND mf.owner_type = 'rfq_item')
    AND NOT EXISTS (SELECT 1 FROM rfq_item_revisions rev WHERE rev.rfq_item_id = i.rfq_item_id)
);

-- ----------------------------------------------------------
-- 3C. DELETE the duplicate rows.
--     Identical guard conditions as 3B — only deletes rows
--     that have no links in any of the six tables.
-- ----------------------------------------------------------
DELETE FROM rfq_items
WHERE rfq_id = 'RFQ-2026-00006'
  AND trang_thai_dong != 'archived'
  -- Is the newer row (keeper exists as an older row)
  AND EXISTS (
    SELECT 1 FROM rfq_items older
    WHERE older.rfq_id     = rfq_items.rfq_id
      AND older.stt_goc    = rfq_items.stt_goc
      AND older.ma_mua_sam = rfq_items.ma_mua_sam
      AND older.ma_vat_tu  = rfq_items.ma_vat_tu
      AND older.created_at < rfq_items.created_at
      AND older.trang_thai_dong != 'archived'
  )
  -- Zero links on every business table
  AND NOT EXISTS (SELECT 1 FROM technical_clarifications tc
                  WHERE tc.rfq_item_id = rfq_items.rfq_item_id AND tc.deleted_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM supplier_quotes sq
                  WHERE sq.rfq_item_id = rfq_items.rfq_item_id)
  AND NOT EXISTS (SELECT 1 FROM pricing_decisions pd
                  WHERE pd.rfq_item_id = rfq_items.rfq_item_id)
  AND NOT EXISTS (SELECT 1 FROM contract_items ci
                  WHERE ci.rfq_item_id = rfq_items.rfq_item_id)
  AND NOT EXISTS (SELECT 1 FROM media_files mf
                  WHERE mf.owner_id = rfq_items.rfq_item_id AND mf.owner_type = 'rfq_item')
  AND NOT EXISTS (SELECT 1 FROM rfq_item_revisions rev
                  WHERE rev.rfq_item_id = rfq_items.rfq_item_id);
