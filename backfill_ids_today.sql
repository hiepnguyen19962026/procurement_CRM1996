-- ═══════════════════════════════════════════════════════════════════════════
-- Procurement CRM — Backfill old IDs to new format using TODAY's VN date
-- ONE-TIME ONLY. Do not run twice.
--
-- All old TASK-* records → Task-YYYY-MMDD-NN  (YYYY-MMDD = today UTC+7)
-- All old TCL-*  records → Cla-YYYY-MMDD-NN   (today UTC+7)
-- Sequence is ordered by created_at ASC for consistency.
--
-- Already-correct Task-* and Cla-* records are NOT touched.
-- rfq_item_revisions.source_clarification_id updated BEFORE step 3.
--
-- Verify counts before running:
--   wrangler d1 execute procurement-crm2 --remote --command "SELECT count(*) FROM tasks WHERE task_id LIKE 'TASK-%';"
--   wrangler d1 execute procurement-crm2 --remote --command "SELECT count(*) FROM technical_clarifications WHERE clarification_id LIKE 'TCL-%';"
--   wrangler d1 execute procurement-crm2 --remote --command "SELECT count(*) FROM rfq_item_revisions WHERE source_clarification_id LIKE 'TCL-%';"
--
-- Run:
--   wrangler d1 execute procurement-crm2 --remote --file=backfill_ids_today.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. tasks: TASK-* → Task-YYYY-MMDD-NN (today's VN date) ───────────────
WITH today_pfx AS (
  SELECT
    'Task-'
    || strftime('%Y', datetime('now', '+7 hours'))
    || '-'
    || replace(strftime('%m-%d', datetime('now', '+7 hours')), '-', '')
    AS prefix
),
ranked AS (
  SELECT
    t.task_id AS old_id,
    p.prefix || '-' || printf('%02d', ROW_NUMBER() OVER (ORDER BY t.created_at ASC, t.task_id ASC)) AS new_id
  FROM tasks t
  CROSS JOIN today_pfx p
  WHERE t.task_id LIKE 'TASK-%'
)
UPDATE tasks
SET task_id = ranked.new_id
FROM ranked
WHERE tasks.task_id = ranked.old_id;

-- ── 2. rfq_item_revisions: remap source_clarification_id BEFORE step 3 ───
--    (reads original TCL-* ids; step 3 has not run yet)
WITH today_pfx AS (
  SELECT
    'Cla-'
    || strftime('%Y', datetime('now', '+7 hours'))
    || '-'
    || replace(strftime('%m-%d', datetime('now', '+7 hours')), '-', '')
    AS prefix
),
ranked AS (
  SELECT
    c.clarification_id AS old_id,
    p.prefix || '-' || printf('%02d', ROW_NUMBER() OVER (ORDER BY c.created_at ASC, c.clarification_id ASC)) AS new_id
  FROM technical_clarifications c
  CROSS JOIN today_pfx p
  WHERE c.clarification_id LIKE 'TCL-%'
)
UPDATE rfq_item_revisions
SET source_clarification_id = ranked.new_id
FROM ranked
WHERE rfq_item_revisions.source_clarification_id = ranked.old_id;

-- ── 3. technical_clarifications: TCL-* → Cla-YYYY-MMDD-NN (today) ────────
WITH today_pfx AS (
  SELECT
    'Cla-'
    || strftime('%Y', datetime('now', '+7 hours'))
    || '-'
    || replace(strftime('%m-%d', datetime('now', '+7 hours')), '-', '')
    AS prefix
),
ranked AS (
  SELECT
    c.clarification_id AS old_id,
    p.prefix || '-' || printf('%02d', ROW_NUMBER() OVER (ORDER BY c.created_at ASC, c.clarification_id ASC)) AS new_id
  FROM technical_clarifications c
  CROSS JOIN today_pfx p
  WHERE c.clarification_id LIKE 'TCL-%'
)
UPDATE technical_clarifications
SET clarification_id = ranked.new_id
FROM ranked
WHERE technical_clarifications.clarification_id = ranked.old_id;

-- ── Verify after running ──────────────────────────────────────────────────
-- SELECT count(*) FROM tasks WHERE task_id LIKE 'TASK-%';                             -- expect 0
-- SELECT count(*) FROM technical_clarifications WHERE clarification_id LIKE 'TCL-%';  -- expect 0
-- SELECT count(*) FROM rfq_item_revisions WHERE source_clarification_id LIKE 'TCL-%'; -- expect 0
-- SELECT task_id, created_at FROM tasks ORDER BY task_id LIMIT 10;
-- SELECT clarification_id, created_at FROM technical_clarifications ORDER BY clarification_id LIMIT 10;
