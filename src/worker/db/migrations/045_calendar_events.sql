CREATE TABLE IF NOT EXISTS calendar_events (
  event_id            TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  event_date          TEXT NOT NULL,
  start_time          TEXT NOT NULL,
  end_time            TEXT NOT NULL,
  duration_minutes    INTEGER NOT NULL DEFAULT 30,
  owner_id            TEXT,
  company_name        TEXT,
  note                TEXT,
  task_id             TEXT,
  status              TEXT NOT NULL DEFAULT 'scheduled',
  created_by          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date_time
ON calendar_events(event_date, start_time);

CREATE INDEX IF NOT EXISTS idx_calendar_events_owner
ON calendar_events(owner_id, event_date);

CREATE INDEX IF NOT EXISTS idx_calendar_events_task
ON calendar_events(task_id);

CREATE INDEX IF NOT EXISTS idx_calendar_events_deleted_date
ON calendar_events(deleted_at, event_date);
