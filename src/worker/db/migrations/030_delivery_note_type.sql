-- Add note_type to delivery_notes.
-- 'delivery' = DGH (đơn giao hàng), 'return' = DTH (đơn trả hàng).
ALTER TABLE delivery_notes ADD COLUMN note_type TEXT NOT NULL DEFAULT 'delivery'
  CHECK (note_type IN ('delivery', 'return'));

CREATE INDEX IF NOT EXISTS idx_delivery_notes_note_type
  ON delivery_notes(note_type, delivery_date DESC);
