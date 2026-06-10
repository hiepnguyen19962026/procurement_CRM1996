CREATE TABLE IF NOT EXISTS rfq_contacts (
  rfq_contact_id TEXT PRIMARY KEY,
  rfq_id         TEXT NOT NULL,
  client_id      TEXT NOT NULL,
  contact_id     TEXT NOT NULL,
  support_role   TEXT,
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (rfq_id) REFERENCES rfqs(rfq_id),
  FOREIGN KEY (contact_id) REFERENCES client_contacts(contact_id)
);

CREATE INDEX IF NOT EXISTS idx_rfq_contacts_rfq
  ON rfq_contacts(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_contacts_contact
  ON rfq_contacts(contact_id);
