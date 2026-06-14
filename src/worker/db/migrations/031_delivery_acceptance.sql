-- Acceptance / nghiệm thu tracking on delivery notes.
-- No new table — adds columns to existing delivery_notes and delivery_note_items.

-- delivery_notes: header-level acceptance + payment readiness
ALTER TABLE delivery_notes ADD COLUMN acceptance_date   TEXT;
ALTER TABLE delivery_notes ADD COLUMN acceptance_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (acceptance_status IN ('pending','accepted','partial','rejected'));
ALTER TABLE delivery_notes ADD COLUMN acceptance_note   TEXT;
ALTER TABLE delivery_notes ADD COLUMN payment_request_status TEXT NOT NULL DEFAULT 'not_ready'
  CHECK (payment_request_status IN ('not_ready','ready','requested','paid'));
ALTER TABLE delivery_notes ADD COLUMN payment_request_date TEXT;
ALTER TABLE delivery_notes ADD COLUMN payment_note      TEXT;

-- delivery_note_items: per-item result + warranty
ALTER TABLE delivery_note_items ADD COLUMN accepted_quantity  REAL DEFAULT 0;
ALTER TABLE delivery_note_items ADD COLUMN acceptance_status  TEXT NOT NULL DEFAULT 'pending'
  CHECK (acceptance_status IN ('pending','accepted','rejected'));
ALTER TABLE delivery_note_items ADD COLUMN rejection_reason   TEXT;
ALTER TABLE delivery_note_items ADD COLUMN warranty_days      INTEGER;
ALTER TABLE delivery_note_items ADD COLUMN warranty_start_date TEXT;
ALTER TABLE delivery_note_items ADD COLUMN warranty_end_date  TEXT;

CREATE INDEX IF NOT EXISTS idx_delivery_notes_acceptance_status
  ON delivery_notes(acceptance_status, delivery_date DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_note_items_acceptance
  ON delivery_note_items(rfq_item_id, acceptance_status);

CREATE INDEX IF NOT EXISTS idx_delivery_note_items_warranty
  ON delivery_note_items(warranty_end_date);
