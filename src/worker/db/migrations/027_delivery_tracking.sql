CREATE TABLE IF NOT EXISTS delivery_notes (
  delivery_note_id TEXT PRIMARY KEY,
  delivery_note_no TEXT NOT NULL UNIQUE,
  rfq_id TEXT,
  contract_id TEXT,
  client_id TEXT,
  delivery_date TEXT NOT NULL,
  receiver_unit TEXT,
  sender_unit TEXT,
  receiver_name TEXT,
  sender_name TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS delivery_note_items (
  delivery_note_item_id TEXT PRIMARY KEY,
  delivery_note_id TEXT NOT NULL,
  rfq_item_id TEXT NOT NULL,
  contract_item_id TEXT,
  item_id TEXT,
  line_no TEXT,
  ma_vat_tu TEXT,
  ten_vat_tu TEXT NOT NULL,
  required_model TEXT,
  manufacturer TEXT,
  brand TEXT,
  origin_country TEXT,
  unit TEXT,
  delivered_quantity REAL NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (delivery_note_id) REFERENCES delivery_notes(delivery_note_id),
  FOREIGN KEY (rfq_item_id) REFERENCES rfq_items(rfq_item_id),
  FOREIGN KEY (contract_item_id) REFERENCES contract_items(contract_item_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_notes_date ON delivery_notes(delivery_date DESC, delivery_note_id DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_rfq ON delivery_notes(rfq_id, delivery_date DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_contract ON delivery_notes(contract_id, delivery_date DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_client ON delivery_notes(client_id, delivery_date DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_status ON delivery_notes(status);

CREATE INDEX IF NOT EXISTS idx_delivery_note_items_note ON delivery_note_items(delivery_note_id);
CREATE INDEX IF NOT EXISTS idx_delivery_note_items_rfq_item ON delivery_note_items(rfq_item_id, status);
CREATE INDEX IF NOT EXISTS idx_delivery_note_items_contract_item ON delivery_note_items(contract_item_id);
CREATE INDEX IF NOT EXISTS idx_delivery_note_items_item ON delivery_note_items(item_id);
