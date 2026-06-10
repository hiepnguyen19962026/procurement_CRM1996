ALTER TABLE supplier_quotes ADD COLUMN source_channel TEXT;
ALTER TABLE supplier_quotes ADD COLUMN source_ref TEXT;
ALTER TABLE supplier_quotes ADD COLUMN received_at TEXT;

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_source_channel
  ON supplier_quotes(source_channel);
