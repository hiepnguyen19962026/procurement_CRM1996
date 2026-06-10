CREATE TABLE IF NOT EXISTS supplier_quotes (
  quote_id           TEXT    PRIMARY KEY,
  rfq_item_id        TEXT    NOT NULL,
  supplier_id        TEXT,
  supplier_name      TEXT,
  manufacturer       TEXT,
  quote_date         TEXT,
  quoted_price       REAL    DEFAULT 0,
  currency           TEXT    DEFAULT 'VND',
  exchange_rate      REAL    DEFAULT 1,
  price_vnd          INTEGER DEFAULT 0,
  tax_rate           REAL    DEFAULT 0,
  price_vnd_incl_tax INTEGER DEFAULT 0,
  lead_time          TEXT,
  valid_until        TEXT,
  warranty           TEXT,
  note               TEXT,
  status             TEXT    NOT NULL DEFAULT 'active',
  created_by         TEXT,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT,
  FOREIGN KEY (rfq_item_id) REFERENCES rfq_items(rfq_item_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_item
  ON supplier_quotes(rfq_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_status
  ON supplier_quotes(status);
