CREATE TABLE IF NOT EXISTS import_templates (
  template_id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  template_name TEXT NOT NULL,
  description TEXT,
  mapping_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_jobs (
  job_id TEXT PRIMARY KEY,
  owner_key TEXT,
  rfq_id TEXT NOT NULL,
  source_file_name TEXT,
  source_sheet_name TEXT DEFAULT 'csv',
  status TEXT NOT NULL,
  total_rows INTEGER DEFAULT 0,
  created_count INTEGER DEFAULT 0,
  updated_count INTEGER DEFAULT 0,
  skipped_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  committed_at TEXT
);

CREATE TABLE IF NOT EXISTS import_job_rows (
  job_row_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  source_row_number INTEGER,
  raw_row_json TEXT,
  mapped_json TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  rfq_id TEXT,
  rfq_item_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_import_templates_owner
  ON import_templates(owner_key);

CREATE INDEX IF NOT EXISTS idx_import_jobs_created
  ON import_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_job_rows_job
  ON import_job_rows(job_id, source_row_number);
