-- Covering index for the global clarifications list (Làm rõ screen).
-- Covers: WHERE tc.deleted_at IS NULL ORDER BY tc.created_at DESC, tc.clarification_id DESC LIMIT N
CREATE INDEX IF NOT EXISTS idx_tc_global_created
  ON technical_clarifications(deleted_at, created_at DESC, clarification_id DESC);
