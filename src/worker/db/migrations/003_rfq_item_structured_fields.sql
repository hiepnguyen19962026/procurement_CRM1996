ALTER TABLE rfq_items ADD COLUMN required_model TEXT;
ALTER TABLE rfq_items ADD COLUMN brand TEXT;
ALTER TABLE rfq_items ADD COLUMN manufacture_year TEXT;
ALTER TABLE rfq_items ADD COLUMN origin_country TEXT;
ALTER TABLE rfq_items ADD COLUMN manufacturer TEXT;
ALTER TABLE rfq_items ADD COLUMN technical_params TEXT;
ALTER TABLE rfq_items ADD COLUMN unit TEXT;
ALTER TABLE rfq_items ADD COLUMN quantity REAL;
ALTER TABLE rfq_items ADD COLUMN origin_full_text TEXT;
ALTER TABLE rfq_items ADD COLUMN delivery_time TEXT;
ALTER TABLE rfq_items ADD COLUMN note TEXT;

UPDATE rfq_items
SET
  required_model = COALESCE(NULLIF(required_model, ''), quy_cach_model_yeu_cau),
  brand = COALESCE(NULLIF(brand, ''), nhan_hieu),
  manufacture_year = COALESCE(NULLIF(manufacture_year, ''), nam_san_xuat),
  origin_country = COALESCE(NULLIF(origin_country, ''), xuat_xu),
  manufacturer = COALESCE(NULLIF(manufacturer, ''), hang_goc_nsx_goc),
  technical_params = COALESCE(NULLIF(technical_params, ''), thong_so_ky_thuat),
  unit = COALESCE(NULLIF(unit, ''), don_vi),
  quantity = CASE WHEN quantity IS NULL THEN so_luong ELSE quantity END;
