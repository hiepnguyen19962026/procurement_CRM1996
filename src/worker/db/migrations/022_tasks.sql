CREATE TABLE IF NOT EXISTS tasks (
  task_id              TEXT PRIMARY KEY,
  company_name         TEXT,
  company_normalized   TEXT,
  title                TEXT NOT NULL,
  description          TEXT,
  start_date           TEXT,
  deadline_date        TEXT,
  next_followup_date   TEXT,
  status               TEXT NOT NULL DEFAULT 'dang_lam',
  priority             TEXT NOT NULL DEFAULT 'trung_binh',
  progress_percent     INTEGER DEFAULT 0,
  task_type            TEXT,
  latest_note          TEXT,
  completed_at         TEXT,
  last_activity_at     TEXT,
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  deleted_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_company   ON tasks(company_normalized);
CREATE INDEX IF NOT EXISTS idx_tasks_priority  ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline  ON tasks(deadline_date);
CREATE INDEX IF NOT EXISTS idx_tasks_followup  ON tasks(next_followup_date);
CREATE INDEX IF NOT EXISTS idx_tasks_activity  ON tasks(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_created   ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted   ON tasks(deleted_at);
