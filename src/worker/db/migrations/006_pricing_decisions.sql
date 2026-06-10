CREATE TABLE IF NOT EXISTS pricing_decisions (
  pricing_id             TEXT PRIMARY KEY,
  rfq_item_id            TEXT NOT NULL,
  base_quote_id          TEXT,
  base_price_vnd_incl_tax INTEGER DEFAULT 0,
  markup_rate            REAL DEFAULT 1.4,
  selection_reason       TEXT,
  risk_level             TEXT,
  risk_note              TEXT,
  proposed_unit_price    INTEGER DEFAULT 0,
  proposed_line_total    INTEGER DEFAULT 0,
  pricing_note           TEXT,
  version                INTEGER DEFAULT 1,
  created_by             TEXT,
  created_at             TEXT NOT NULL,
  FOREIGN KEY (rfq_item_id)  REFERENCES rfq_items(rfq_item_id),
  FOREIGN KEY (base_quote_id) REFERENCES supplier_quotes(quote_id)
);

CREATE INDEX IF NOT EXISTS idx_pricing_rfq_item  ON pricing_decisions(rfq_item_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_base_quote ON pricing_decisions(base_quote_id);
