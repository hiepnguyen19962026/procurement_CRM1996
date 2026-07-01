CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_rfq_item_version_unique
ON pricing_decisions(rfq_item_id, version);
