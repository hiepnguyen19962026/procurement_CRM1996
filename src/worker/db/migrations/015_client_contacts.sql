CREATE TABLE IF NOT EXISTS client_contacts (
  contact_id     TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  contact_name   TEXT NOT NULL,
  department     TEXT,
  position       TEXT,
  role_type      TEXT NOT NULL DEFAULT 'other',
  specialty_tags TEXT,
  phone          TEXT,
  email          TEXT,
  zalo           TEXT,
  note           TEXT,
  is_primary     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active',
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_contacts_client
  ON client_contacts(client_id);
CREATE INDEX IF NOT EXISTS idx_client_contacts_role
  ON client_contacts(role_type);
