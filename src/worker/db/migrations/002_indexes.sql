CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(client_name);
CREATE INDEX IF NOT EXISTS idx_clients_search ON clients(normalized_search);

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(supplier_name);
CREATE INDEX IF NOT EXISTS idx_suppliers_search ON suppliers(normalized_search);

CREATE INDEX IF NOT EXISTS idx_rfqs_client ON rfqs(client_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_status ON rfqs(trang_thai_goi);
CREATE INDEX IF NOT EXISTS idx_rfqs_created ON rfqs(created_at, rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_search ON rfqs(normalized_search);

CREATE INDEX IF NOT EXISTS idx_rfq_items_rfq ON rfq_items(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_items_ma_vat_tu ON rfq_items(ma_vat_tu);
CREATE INDEX IF NOT EXISTS idx_rfq_items_ma_mua_sam ON rfq_items(ma_mua_sam);
CREATE INDEX IF NOT EXISTS idx_rfq_items_status ON rfq_items(trang_thai_dong);
CREATE INDEX IF NOT EXISTS idx_rfq_items_created ON rfq_items(created_at, rfq_item_id);
CREATE INDEX IF NOT EXISTS idx_rfq_items_search ON rfq_items(normalized_search);

CREATE INDEX IF NOT EXISTS idx_media_owner ON media_files(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_media_kind ON media_files(file_kind);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at, audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
