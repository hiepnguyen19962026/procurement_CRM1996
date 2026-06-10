ALTER TABLE clients ADD COLUMN tax_code   TEXT;
ALTER TABLE clients ADD COLUMN legal_name  TEXT;
ALTER TABLE clients ADD COLUMN client_type TEXT DEFAULT 'company';
ALTER TABLE clients ADD COLUMN address     TEXT;
ALTER TABLE clients ADD COLUMN email       TEXT;
ALTER TABLE clients ADD COLUMN phone       TEXT;
ALTER TABLE clients ADD COLUMN website     TEXT;
