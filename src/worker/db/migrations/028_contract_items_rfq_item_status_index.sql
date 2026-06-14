CREATE INDEX IF NOT EXISTS idx_contract_items_rfq_item_status
ON contract_items(rfq_item_id, status);
