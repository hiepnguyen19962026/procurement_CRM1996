CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','purchasing','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','frozen','archived')),
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  plant_name TEXT,
  province TEXT,
  note TEXT,
  normalized_search TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id TEXT PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  supplier_type TEXT DEFAULT 'unknown',
  country TEXT,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  zalo TEXT,
  wechat TEXT,
  note TEXT,
  normalized_search TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rfqs (
  rfq_id TEXT PRIMARY KEY,
  client_id TEXT,
  ma_goi_tbmt TEXT,
  ten_goi TEXT NOT NULL,
  nha_may_cdt TEXT,
  ngay_nhan_hoac_dang_tai TEXT,
  ngay_het_han TEXT,
  du_toan INTEGER DEFAULT 0,
  trang_thai_goi TEXT NOT NULL DEFAULT 'dang_khao_gia',
  source_file_id TEXT,
  note TEXT,
  normalized_search TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE TABLE IF NOT EXISTS rfq_items (
  rfq_item_id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL,
  stt_goc TEXT,
  id_import_goc TEXT,
  ma_mua_sam TEXT,
  ma_vat_tu TEXT,
  ten_vat_tu TEXT NOT NULL,
  quy_cach_model_yeu_cau TEXT,
  hang_goc_nsx_goc TEXT,
  hang_bao_gia_nsx_bao_gia TEXT,
  nhan_hieu TEXT,
  xuat_xu TEXT,
  nam_san_xuat TEXT,
  vat_lieu TEXT,
  phu_tung_chuyen_dung TEXT,
  thong_so_ky_thuat TEXT,
  yeu_cau_ky_thuat_bo_sung TEXT,
  so_luong REAL DEFAULT 0,
  don_vi TEXT,
  thue_suat REAL DEFAULT 0,
  don_gia_truoc_thue INTEGER DEFAULT 0,
  don_gia_sau_thue INTEGER DEFAULT 0,
  thanh_tien_sau_thue INTEGER DEFAULT 0,
  nguon_gia TEXT,
  trang_thai_dong TEXT NOT NULL DEFAULT 'chua_xu_ly',
  trang_thai_ky_thuat TEXT NOT NULL DEFAULT 'khong_can_xac_nhan',
  quy_cach_final TEXT,
  hang_final TEXT,
  xuat_xu_final TEXT,
  ghi_chu_final TEXT,
  item_id TEXT,
  normalized_search TEXT,
  raw_row_json TEXT,
  source_file_id TEXT,
  source_sheet_name TEXT,
  source_row_number INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (rfq_id) REFERENCES rfqs(rfq_id)
);

CREATE TABLE IF NOT EXISTS media_files (
  file_id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT,
  file_kind TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  public_url TEXT,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER DEFAULT 0,
  width INTEGER,
  height INTEGER,
  variant TEXT,
  is_primary INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  message TEXT,
  old_json TEXT,
  new_json TEXT,
  actor_id TEXT,
  actor_name TEXT,
  created_at TEXT NOT NULL
);
