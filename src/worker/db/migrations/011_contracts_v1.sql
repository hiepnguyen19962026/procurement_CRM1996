CREATE TABLE IF NOT EXISTS contracts (
  contract_id   TEXT    PRIMARY KEY,
  rfq_id        TEXT,
  contract_no   TEXT    NOT NULL,
  contract_name TEXT,
  client_id     TEXT,
  signed_date   TEXT,
  effective_date TEXT,
  expiry_date   TEXT,
  currency      TEXT    DEFAULT 'VND',
  contract_total INTEGER DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'active',
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  archived_at   TEXT
);

CREATE TABLE IF NOT EXISTS contract_items (
  contract_item_id TEXT    PRIMARY KEY,
  contract_id      TEXT    NOT NULL,
  rfq_item_id      TEXT,
  item_id          TEXT,
  line_no          TEXT,
  ma_vat_tu        TEXT,
  ten_vat_tu       TEXT    NOT NULL,
  required_model   TEXT,
  manufacturer     TEXT,
  brand            TEXT,
  origin_country   TEXT,
  unit             TEXT,
  contract_quantity REAL   DEFAULT 0,
  contract_unit_price INTEGER DEFAULT 0,
  contract_line_total INTEGER DEFAULT 0,
  supplier_id      TEXT,
  supplier_name    TEXT,
  source_quote_id  TEXT,
  status           TEXT    NOT NULL DEFAULT 'active',
  note             TEXT,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  archived_at      TEXT,
  FOREIGN KEY (contract_id) REFERENCES contracts(contract_id)
);

CREATE INDEX IF NOT EXISTS idx_contracts_rfq          ON contracts(rfq_id);
CREATE INDEX IF NOT EXISTS idx_contracts_client       ON contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_signed_date  ON contracts(signed_date DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_status       ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contract_items_contract    ON contract_items(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_items_rfq_item    ON contract_items(rfq_item_id);
CREATE INDEX IF NOT EXISTS idx_contract_items_item        ON contract_items(item_id);
CREATE INDEX IF NOT EXISTS idx_contract_items_source_quote ON contract_items(source_quote_id);
