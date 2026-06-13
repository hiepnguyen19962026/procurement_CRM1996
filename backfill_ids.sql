-- ═══════════════════════════════════════════════════════════════════════════
-- Procurement CRM — Backfill old ID formats (ONE-TIME, run manually)
--
-- tasks:
--   TASK-YYYY-NNNNN  →  Task-YYYY-MMDD-NN  (based on created_at UTC+7)
--
-- technical_clarifications:
--   TCL-YYYY-XXXXXXXX  →  Cla-YYYY-MMDD-NN  (based on created_at UTC+7)
--
-- rfq_item_revisions.source_clarification_id updated to match new IDs.
--
-- SAFE to run: only touches rows WHERE id LIKE 'TASK-%' or 'TCL-%'.
-- New-format IDs (Task-*, Cla-*) are untouched.
--
-- Step 2 (rfq_item_revisions) runs BEFORE step 3 (technical_clarifications)
-- so the mapping CTE reads the original TCL-* values in both steps.
--
-- Command:
--   wrangler d1 execute procurement-crm-db --remote --file=backfill_ids.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. tasks: TASK-YYYY-NNNNN → Task-YYYY-MMDD-NN ────────────────────────
WITH new_task_ids AS (
  SELECT
    task_id AS old_id,
    'Task-'
      || strftime('%Y', datetime(created_at, '+7 hours'))
      || '-'
      || replace(strftime('%m-%d', datetime(created_at, '+7 hours')), '-', '')
      || '-'
      || printf('%02d', ROW_NUMBER() OVER (
           PARTITION BY strftime('%Y-%m-%d', datetime(created_at, '+7 hours'))
           ORDER BY created_at ASC, task_id ASC
         ))
    AS new_id
  FROM tasks
  WHERE task_id LIKE 'TASK-%'
)
UPDATE tasks
SET task_id = new_task_ids.new_id
FROM new_task_ids
WHERE tasks.task_id = new_task_ids.old_id;

-- ── 2. rfq_item_revisions.source_clarification_id — update BEFORE step 3 ─
--    (reads original TCL-* values from technical_clarifications)
WITH new_clar_ids AS (
  SELECT
    clarification_id AS old_id,
    'Cla-'
      || strftime('%Y', datetime(created_at, '+7 hours'))
      || '-'
      || replace(strftime('%m-%d', datetime(created_at, '+7 hours')), '-', '')
      || '-'
      || printf('%02d', ROW_NUMBER() OVER (
           PARTITION BY strftime('%Y-%m-%d', datetime(created_at, '+7 hours'))
           ORDER BY created_at ASC, clarification_id ASC
         ))
    AS new_id
  FROM technical_clarifications
  WHERE clarification_id LIKE 'TCL-%'
)
UPDATE rfq_item_revisions
SET source_clarification_id = new_clar_ids.new_id
FROM new_clar_ids
WHERE rfq_item_revisions.source_clarification_id = new_clar_ids.old_id;

-- ── 3. technical_clarifications: TCL-YYYY-XXXXXXXX → Cla-YYYY-MMDD-NN ────
--    (still reads TCL-* values because step 3 hasn't run yet above)
WITH new_clar_ids AS (
  SELECT
    clarification_id AS old_id,
    'Cla-'
      || strftime('%Y', datetime(created_at, '+7 hours'))
      || '-'
      || replace(strftime('%m-%d', datetime(created_at, '+7 hours')), '-', '')
      || '-'
      || printf('%02d', ROW_NUMBER() OVER (
           PARTITION BY strftime('%Y-%m-%d', datetime(created_at, '+7 hours'))
           ORDER BY created_at ASC, clarification_id ASC
         ))
    AS new_id
  FROM technical_clarifications
  WHERE clarification_id LIKE 'TCL-%'
)
UPDATE technical_clarifications
SET clarification_id = new_clar_ids.new_id
FROM new_clar_ids
WHERE technical_clarifications.clarification_id = new_clar_ids.old_id;

COMMIT;

-- ── Verification queries (run separately after the backfill) ──────────────
-- Check no TASK-* IDs remain:
--   SELECT count(*) FROM tasks WHERE task_id LIKE 'TASK-%';   -- expect 0
-- Check no TCL-* IDs remain:
--   SELECT count(*) FROM technical_clarifications WHERE clarification_id LIKE 'TCL-%';  -- expect 0
-- Check rfq_item_revisions consistency:
--   SELECT count(*) FROM rfq_item_revisions WHERE source_clarification_id LIKE 'TCL-%';  -- expect 0
-- Spot-check new format:
--   SELECT task_id, created_at FROM tasks ORDER BY created_at ASC LIMIT 10;
--   SELECT clarification_id, created_at FROM technical_clarifications ORDER BY created_at ASC LIMIT 10;
