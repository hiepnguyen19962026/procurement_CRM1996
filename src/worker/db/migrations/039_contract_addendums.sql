ALTER TABLE contracts ADD COLUMN original_contract_total INTEGER;

UPDATE contracts
SET original_contract_total = COALESCE(original_contract_total, contract_total, 0)
WHERE original_contract_total IS NULL;

CREATE TABLE IF NOT EXISTS contract_addendums (
  addendum_id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  addendum_no TEXT NOT NULL,
  addendum_name TEXT,
  signed_date TEXT,
  value_before_tax INTEGER DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  value_after_tax INTEGER DEFAULT 0,
  amount_delta INTEGER DEFAULT 0,
  note TEXT,
  external_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (contract_id) REFERENCES contracts(contract_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_addendums_contract_status
ON contract_addendums(contract_id, status);

CREATE INDEX IF NOT EXISTS idx_contract_addendums_signed_date
ON contract_addendums(signed_date DESC);

CREATE INDEX IF NOT EXISTS idx_contract_addendums_created_at
ON contract_addendums(created_at DESC);
