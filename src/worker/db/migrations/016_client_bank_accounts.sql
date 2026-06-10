CREATE TABLE IF NOT EXISTS client_bank_accounts (
  bank_account_id TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  account_name    TEXT,
  bank_account    TEXT NOT NULL,
  bank_name       TEXT NOT NULL,
  branch_name     TEXT,
  currency        TEXT NOT NULL DEFAULT 'VND',
  is_primary      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active',
  note            TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_bank_accounts_client
  ON client_bank_accounts(client_id);
