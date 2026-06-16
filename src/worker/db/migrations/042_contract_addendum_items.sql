CREATE TABLE IF NOT EXISTS contract_addendum_items (
  addendum_item_id TEXT PRIMARY KEY,
  addendum_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  rfq_item_id TEXT,
  item_type TEXT NOT NULL DEFAULT 'material',
  item_code TEXT,
  item_name TEXT NOT NULL,
  spec TEXT,
  unit TEXT,
  quantity REAL DEFAULT 0,
  unit_price INTEGER DEFAULT 0,
  line_total INTEGER DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (addendum_id) REFERENCES contract_addendums(addendum_id),
  FOREIGN KEY (contract_id) REFERENCES contracts(contract_id),
  FOREIGN KEY (rfq_item_id) REFERENCES rfq_items(rfq_item_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_addendum_items_addendum_status
ON contract_addendum_items(addendum_id, status);

CREATE INDEX IF NOT EXISTS idx_contract_addendum_items_contract_status
ON contract_addendum_items(contract_id, status);

CREATE INDEX IF NOT EXISTS idx_contract_addendum_items_rfq_item
ON contract_addendum_items(rfq_item_id);
