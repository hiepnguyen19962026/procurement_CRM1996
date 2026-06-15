-- ============================================================
-- FILE 2 of 4: MERGE UPDATE
-- PURPOSE : Copy corrected unit/don_vi/quantity/so_luong from
--           each newer duplicate row into its older keeper row.
--           Only copies 4 fields. Does NOT touch any other column.
--           Does NOT delete anything.
-- Prerequisite: file 01 returned 0 conflict rows in check 1E.
-- Run with: wrangler d1 execute <db-name> --file=...02_merge_update.sql
-- After running, read the verification SELECT at the bottom.
-- ============================================================

-- ----------------------------------------------------------
-- 2A. UPDATE keeper rows with corrected values from duplicate.
--     Keeper = oldest created_at per (rfq_id, stt_goc, ma_mua_sam, ma_vat_tu).
--     Source = newest created_at in same group (the bad-import duplicate).
-- ----------------------------------------------------------
UPDATE rfq_items
SET
  unit     = (
    SELECT dup.unit FROM rfq_items dup
    WHERE dup.rfq_id     = rfq_items.rfq_id
      AND dup.stt_goc    = rfq_items.stt_goc
      AND dup.ma_mua_sam = rfq_items.ma_mua_sam
      AND dup.ma_vat_tu  = rfq_items.ma_vat_tu
      AND dup.created_at > rfq_items.created_at
      AND dup.trang_thai_dong != 'archived'
    ORDER BY dup.created_at DESC LIMIT 1
  ),
  don_vi   = (
    SELECT dup.don_vi FROM rfq_items dup
    WHERE dup.rfq_id     = rfq_items.rfq_id
      AND dup.stt_goc    = rfq_items.stt_goc
      AND dup.ma_mua_sam = rfq_items.ma_mua_sam
      AND dup.ma_vat_tu  = rfq_items.ma_vat_tu
      AND dup.created_at > rfq_items.created_at
      AND dup.trang_thai_dong != 'archived'
    ORDER BY dup.created_at DESC LIMIT 1
  ),
  quantity = (
    SELECT dup.quantity FROM rfq_items dup
    WHERE dup.rfq_id     = rfq_items.rfq_id
      AND dup.stt_goc    = rfq_items.stt_goc
      AND dup.ma_mua_sam = rfq_items.ma_mua_sam
      AND dup.ma_vat_tu  = rfq_items.ma_vat_tu
      AND dup.created_at > rfq_items.created_at
      AND dup.trang_thai_dong != 'archived'
    ORDER BY dup.created_at DESC LIMIT 1
  ),
  so_luong = (
    SELECT dup.so_luong FROM rfq_items dup
    WHERE dup.rfq_id     = rfq_items.rfq_id
      AND dup.stt_goc    = rfq_items.stt_goc
      AND dup.ma_mua_sam = rfq_items.ma_mua_sam
      AND dup.ma_vat_tu  = rfq_items.ma_vat_tu
      AND dup.created_at > rfq_items.created_at
      AND dup.trang_thai_dong != 'archived'
    ORDER BY dup.created_at DESC LIMIT 1
  ),
  updated_at = datetime('now')
WHERE rfq_id = 'RFQ-2026-00006'
  AND trang_thai_dong != 'archived'
  -- Only update the keeper (oldest in its group that also has a newer duplicate)
  AND EXISTS (
    SELECT 1 FROM rfq_items newer
    WHERE newer.rfq_id     = rfq_items.rfq_id
      AND newer.stt_goc    = rfq_items.stt_goc
      AND newer.ma_mua_sam = rfq_items.ma_mua_sam
      AND newer.ma_vat_tu  = rfq_items.ma_vat_tu
      AND newer.created_at > rfq_items.created_at
      AND newer.trang_thai_dong != 'archived'
  )
  AND NOT EXISTS (
    SELECT 1 FROM rfq_items older
    WHERE older.rfq_id     = rfq_items.rfq_id
      AND older.stt_goc    = rfq_items.stt_goc
      AND older.ma_mua_sam = rfq_items.ma_mua_sam
      AND older.ma_vat_tu  = rfq_items.ma_vat_tu
      AND older.created_at < rfq_items.created_at
      AND older.trang_thai_dong != 'archived'
  );

-- ----------------------------------------------------------
-- 2B. Verify: show all keeper rows after update.
--     unit/don_vi/quantity/so_luong should now hold correct values.
--     Compare against dup_unit/dup_qty from file 01 check 1D.
-- ----------------------------------------------------------
SELECT
  keeper.rfq_item_id   AS keeper_id,
  keeper.stt_goc,
  keeper.ma_vat_tu,
  keeper.unit          AS unit_after,
  keeper.don_vi        AS don_vi_after,
  keeper.quantity      AS quantity_after,
  keeper.so_luong      AS so_luong_after,
  keeper.updated_at,
  (SELECT COUNT(*) FROM technical_clarifications tc
   WHERE tc.rfq_item_id = keeper.rfq_item_id
     AND tc.deleted_at IS NULL)                                    AS keeper_tc_count
FROM rfq_items keeper
WHERE keeper.rfq_id = 'RFQ-2026-00006'
  AND keeper.trang_thai_dong != 'archived'
  AND EXISTS (
    SELECT 1 FROM rfq_items newer
    WHERE newer.rfq_id     = keeper.rfq_id
      AND newer.stt_goc    = keeper.stt_goc
      AND newer.ma_mua_sam = keeper.ma_mua_sam
      AND newer.ma_vat_tu  = keeper.ma_vat_tu
      AND newer.created_at > keeper.created_at
      AND newer.trang_thai_dong != 'archived'
  )
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
-- If all unit/don_vi/quantity/so_luong look correct → proceed to file 03.
-- If any row shows wrong values → stop. Do NOT run file 03 until fixed.
