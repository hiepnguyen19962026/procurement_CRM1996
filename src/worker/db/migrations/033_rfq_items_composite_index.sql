-- Covering index for the most common rfq_items query:
-- per-RFQ, non-archived items, default sort by source_row_number.
-- No table or data change.
CREATE INDEX IF NOT EXISTS idx_rfq_items_rfq_status_row
  ON rfq_items(rfq_id, trang_thai_dong, source_row_number, rfq_item_id);
