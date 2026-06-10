CREATE TABLE IF NOT EXISTS client_legal_history (
  legal_history_id TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL,
  effective_date   TEXT NOT NULL,
  legal_name       TEXT,
  tax_code         TEXT,
  address          TEXT,
  note             TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_legal_history_client
  ON client_legal_history(client_id, effective_date);
