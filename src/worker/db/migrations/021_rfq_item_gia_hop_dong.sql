-- Add contract unit price directly on rfq_items for historical package imports
ALTER TABLE rfq_items ADD COLUMN gia_hop_dong INTEGER DEFAULT 0;
