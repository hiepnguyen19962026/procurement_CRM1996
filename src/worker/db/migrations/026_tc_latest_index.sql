-- Covering index for the "latest clarification per item" lookup.
-- Eliminates full-scan on deleted_at filter when ORDER BY created_at DESC, sequence_no DESC LIMIT 1.
CREATE INDEX IF NOT EXISTS idx_technical_clarifications_item_latest
  ON technical_clarifications(rfq_item_id, deleted_at, created_at DESC, sequence_no DESC);
