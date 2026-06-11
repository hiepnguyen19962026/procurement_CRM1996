-- Migration 019: RFQ Item revision history
-- Additive only. No existing tables or rows modified.

ALTER TABLE rfq_items ADD COLUMN current_revision_no INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS rfq_item_revisions (
  revision_id              TEXT PRIMARY KEY,
  rfq_item_id              TEXT NOT NULL,
  revision_no              INTEGER NOT NULL,
  source_clarification_id  TEXT,
  -- snapshot of spec fields at this revision point
  ma_mua_sam               TEXT,
  ma_vat_tu                TEXT,
  ten_vat_tu               TEXT,
  required_model           TEXT,
  manufacturer             TEXT,
  brand                    TEXT,
  origin_country           TEXT,
  technical_params         TEXT,
  note                     TEXT,
  quy_cach_final           TEXT,
  hang_final               TEXT,
  xuat_xu_final            TEXT,
  trang_thai_ky_thuat      TEXT,
  created_at               TEXT NOT NULL,
  created_by               TEXT,
  UNIQUE (rfq_item_id, revision_no),
  FOREIGN KEY (rfq_item_id) REFERENCES rfq_items(rfq_item_id)
);

CREATE INDEX IF NOT EXISTS idx_rfq_item_revisions_item
ON rfq_item_revisions(rfq_item_id, revision_no);
