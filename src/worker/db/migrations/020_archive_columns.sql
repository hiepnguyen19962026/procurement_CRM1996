-- Soft-delete for clients and suppliers
ALTER TABLE clients ADD COLUMN deleted_at TEXT;
ALTER TABLE suppliers ADD COLUMN deleted_at TEXT;
