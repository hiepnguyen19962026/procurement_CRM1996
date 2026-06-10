CREATE TABLE IF NOT EXISTS technical_clarifications (
  clarification_id TEXT PRIMARY KEY,
  rfq_item_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  clarification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  old_model TEXT,
  proposed_model TEXT,
  proposed_manufacturer TEXT,
  proposed_origin TEXT,
  status_after TEXT,
  attachment_file_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT,
  raw_note TEXT,
  FOREIGN KEY (rfq_item_id) REFERENCES rfq_items(rfq_item_id)
);

CREATE INDEX IF NOT EXISTS idx_technical_clarifications_item_created
ON technical_clarifications(rfq_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_technical_clarifications_item_seq
ON technical_clarifications(rfq_item_id, sequence_no);
