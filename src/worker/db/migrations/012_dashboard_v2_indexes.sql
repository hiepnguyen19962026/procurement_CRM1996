-- Dashboard V2: indexes for date-range filters not covered by existing indexes.
-- idx_rfqs_status (trang_thai_goi) already exists in 002.
-- idx_supplier_quotes_source_channel already exists in 007.
-- New: ngay_het_han for due_soon/overdue filters, supplier_quotes(created_at) for global time-range.

CREATE INDEX IF NOT EXISTS idx_rfqs_het_han
  ON rfqs(ngay_het_han);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_created
  ON supplier_quotes(created_at DESC);
