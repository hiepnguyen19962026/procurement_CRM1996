ALTER TABLE contract_items ADD COLUMN delivery_lead_days INTEGER;
ALTER TABLE contract_items ADD COLUMN delivery_trigger_type TEXT;
ALTER TABLE contract_items ADD COLUMN delivery_trigger_date TEXT;
ALTER TABLE contract_items ADD COLUMN delivery_deadline_date TEXT;

CREATE INDEX IF NOT EXISTS idx_contract_items_delivery_deadline
ON contract_items(delivery_deadline_date, status, rfq_item_id);
