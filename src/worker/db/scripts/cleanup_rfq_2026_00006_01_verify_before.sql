-- ============================================================
-- FILE 1 of 4: VERIFY BEFORE
-- PURPOSE : Read-only pre-flight checks. No data is changed.
-- Run with: wrangler d1 execute <db-name> --file=...01_verify_before.sql
-- Read ALL output before running file 02.
-- ============================================================

-- ----------------------------------------------------------
-- 1A. Total item count (expect ~134 if every item was doubled)
-- ----------------------------------------------------------
SELECT '1A: total items in RFQ-2026-00006' AS check_label,
       COUNT(*) AS val
FROM rfq_items
WHERE rfq_id = 'RFQ-2026-00006'
  AND trang_thai_dong != 'archived';

-- ----------------------------------------------------------
-- 1B. Number of identity groups that have more than one row
--     (expect 67 if every item was duplicated)
-- ----------------------------------------------------------
SELECT '1B: duplicate identity groups' AS check_label,
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
-- 1C. Full detail of every row that is part of a duplicate group.
--     Shows rfq_item_id, identity fields, unit/quantity values,
--     created_at, and link counts for every referenced table.
--     Use this to confirm:
--       - older row (lower created_at) = keeper with TC/quote links
--       - newer row (higher created_at) = duplicate with 0 links
-- ----------------------------------------------------------
SELECT
  i.rfq_item_id,
  i.stt_goc,
  i.ma_vat_tu,
  i.ten_vat_tu,
  i.unit,
  i.don_vi,
  i.quantity,
  i.so_luong,
  i.created_at,
  (SELECT COUNT(*) FROM technical_clarifications tc
   WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL)      AS tc_count,
  (SELECT COUNT(*) FROM supplier_quotes sq
   WHERE sq.rfq_item_id = i.rfq_item_id)                                AS sq_count,
  (SELECT COUNT(*) FROM pricing_decisions pd
   WHERE pd.rfq_item_id = i.rfq_item_id)                                AS pd_count,
  (SELECT COUNT(*) FROM contract_items ci
   WHERE ci.rfq_item_id = i.rfq_item_id)                                AS ci_count,
  (SELECT COUNT(*) FROM media_files mf
   WHERE mf.owner_id = i.rfq_item_id AND mf.owner_type = 'rfq_item')   AS media_count,
  (SELECT COUNT(*) FROM rfq_item_revisions rev
   WHERE rev.rfq_item_id = i.rfq_item_id)                               AS rev_count,
  (SELECT COUNT(*) FROM import_job_rows ijr
   WHERE ijr.rfq_item_id = i.rfq_item_id)                               AS import_job_row_count
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
  )
ORDER BY i.stt_goc, i.ma_vat_tu, i.created_at;

-- ----------------------------------------------------------
-- 1D. Explicit keeper/duplicate pairs side by side.
--     keeper_id  = older row (will be kept and updated).
--     dup_id     = newer row (will be deleted if no links).
--     Verify keeper_id has links; dup_id has 0 links.
-- ----------------------------------------------------------
SELECT
  keeper.rfq_item_id    AS keeper_id,
  keeper.created_at     AS keeper_created,
  keeper.unit           AS keeper_unit,
  keeper.quantity       AS keeper_qty,
  (SELECT COUNT(*) FROM technical_clarifications tc
   WHERE tc.rfq_item_id = keeper.rfq_item_id
     AND tc.deleted_at IS NULL)                                         AS keeper_tc,
  (SELECT COUNT(*) FROM supplier_quotes sq
   WHERE sq.rfq_item_id = keeper.rfq_item_id)                          AS keeper_sq,
  dup.rfq_item_id       AS dup_id,
  dup.created_at        AS dup_created,
  dup.unit              AS dup_unit,
  dup.quantity          AS dup_qty,
  (SELECT COUNT(*) FROM technical_clarifications tc
   WHERE tc.rfq_item_id = dup.rfq_item_id
     AND tc.deleted_at IS NULL)                                         AS dup_tc,
  (SELECT COUNT(*) FROM supplier_quotes sq
   WHERE sq.rfq_item_id = dup.rfq_item_id)                             AS dup_sq,
  (SELECT COUNT(*) FROM pricing_decisions pd
   WHERE pd.rfq_item_id = dup.rfq_item_id)                             AS dup_pd,
  (SELECT COUNT(*) FROM contract_items ci
   WHERE ci.rfq_item_id = dup.rfq_item_id)                             AS dup_ci,
  (SELECT COUNT(*) FROM media_files mf
   WHERE mf.owner_id = dup.rfq_item_id AND mf.owner_type = 'rfq_item') AS dup_media,
  (SELECT COUNT(*) FROM rfq_item_revisions rev
   WHERE rev.rfq_item_id = dup.rfq_item_id)                            AS dup_rev,
  (SELECT COUNT(*) FROM import_job_rows ijr
   WHERE ijr.rfq_item_id = dup.rfq_item_id)                            AS dup_import_rows
FROM rfq_items keeper
JOIN rfq_items dup
  ON  dup.rfq_id     = keeper.rfq_id
  AND dup.stt_goc    = keeper.stt_goc
  AND dup.ma_mua_sam = keeper.ma_mua_sam
  AND dup.ma_vat_tu  = keeper.ma_vat_tu
  AND dup.created_at > keeper.created_at
  AND dup.trang_thai_dong != 'archived'
WHERE keeper.rfq_id = 'RFQ-2026-00006'
  AND keeper.trang_thai_dong != 'archived'
  -- keeper is the oldest in its group
  AND NOT EXISTS (
    SELECT 1 FROM rfq_items older
    WHERE older.rfq_id     = keeper.rfq_id
      AND older.stt_goc    = keeper.stt_goc
      AND older.ma_mua_sam = keeper.ma_mua_sam
      AND older.ma_vat_tu  = keeper.ma_vat_tu
      AND older.created_at < keeper.created_at
      AND older.trang_thai_dong != 'archived'
  )
ORDER BY keeper.stt_goc;

-- ----------------------------------------------------------
-- 1E. CONFLICT CHECK — rows where BOTH keeper and duplicate
--     have linked records. File 03 will NOT delete these.
--     If this query returns rows, handle manually before proceeding.
-- ----------------------------------------------------------
SELECT
  'CONFLICT — both rows have linked records' AS warning,
  i.rfq_item_id,
  i.stt_goc,
  i.ma_vat_tu,
  i.ten_vat_tu,
  i.created_at,
  (SELECT COUNT(*) FROM technical_clarifications tc
   WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL) AS tc_count,
  (SELECT COUNT(*) FROM supplier_quotes sq
   WHERE sq.rfq_item_id = i.rfq_item_id)                           AS sq_count,
  (SELECT COUNT(*) FROM contract_items ci
   WHERE ci.rfq_item_id = i.rfq_item_id)                           AS ci_count
FROM rfq_items i
WHERE i.rfq_id = 'RFQ-2026-00006'
  AND i.trang_thai_dong != 'archived'
  -- This row itself has at least one link
  AND (
    EXISTS (SELECT 1 FROM technical_clarifications tc
            WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM supplier_quotes sq WHERE sq.rfq_item_id = i.rfq_item_id)
    OR EXISTS (SELECT 1 FROM pricing_decisions pd WHERE pd.rfq_item_id = i.rfq_item_id)
    OR EXISTS (SELECT 1 FROM contract_items ci WHERE ci.rfq_item_id = i.rfq_item_id)
  )
  -- AND the other row in the same group also has at least one link
  AND EXISTS (
    SELECT 1 FROM rfq_items i2
    WHERE i2.rfq_id      = i.rfq_id
      AND i2.stt_goc     = i.stt_goc
      AND i2.ma_mua_sam  = i.ma_mua_sam
      AND i2.ma_vat_tu   = i.ma_vat_tu
      AND i2.rfq_item_id != i.rfq_item_id
      AND i2.trang_thai_dong != 'archived'
      AND (
        EXISTS (SELECT 1 FROM technical_clarifications tc2
                WHERE tc2.rfq_item_id = i2.rfq_item_id AND tc2.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM supplier_quotes sq2 WHERE sq2.rfq_item_id = i2.rfq_item_id)
        OR EXISTS (SELECT 1 FROM pricing_decisions pd2 WHERE pd2.rfq_item_id = i2.rfq_item_id)
        OR EXISTS (SELECT 1 FROM contract_items ci2 WHERE ci2.rfq_item_id = i2.rfq_item_id)
      )
  )
ORDER BY i.stt_goc, i.created_at;
-- If 1E returns 0 rows → safe to proceed to file 02 and 03.
-- If 1E returns rows  → stop, investigate each conflict before continuing.
