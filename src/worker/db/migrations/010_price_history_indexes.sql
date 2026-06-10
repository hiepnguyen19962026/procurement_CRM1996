-- Add missing index for price history supplier_id filter.
-- Other indexes required by searchPriceHistory already exist:
--   idx_supplier_quotes_item      (rfq_item_id, created_at) — 005
--   idx_supplier_quotes_source_channel (source_channel) — 007
--   idx_rfq_items_item_id         (item_id) — 009
--   idx_rfq_items_ma_vat_tu       (ma_vat_tu) — 002
--   idx_rfqs_client               (client_id) — 002
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_supplier
  ON supplier_quotes(supplier_id);
