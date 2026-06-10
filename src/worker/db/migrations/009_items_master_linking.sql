CREATE TABLE IF NOT EXISTS items (
  item_id TEXT PRIMARY KEY,
  ma_vat_tu TEXT,
  ten_vat_tu TEXT NOT NULL,
  required_model TEXT,
  manufacturer TEXT,
  brand TEXT,
  origin_country TEXT,
  unit TEXT,
  technical_params TEXT,
  note TEXT,
  normalized_search TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_ma_vat_tu ON items(ma_vat_tu);
CREATE INDEX IF NOT EXISTS idx_items_normalized_search ON items(normalized_search);
CREATE INDEX IF NOT EXISTS idx_items_manufacturer ON items(manufacturer);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_rfq_items_item_id ON rfq_items(item_id);
