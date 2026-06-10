CREATE TABLE IF NOT EXISTS client_equipment (
  equipment_id              TEXT PRIMARY KEY,
  client_id                 TEXT NOT NULL,
  plant_name                TEXT,
  unit_no                   TEXT,
  system_area               TEXT,
  equipment_group           TEXT NOT NULL,
  equipment_name            TEXT,
  equipment_tag             TEXT,
  oem_manufacturer          TEXT,
  oem_model                 TEXT,
  oem_spec                  TEXT,
  oem_part_no               TEXT,
  replacement_manufacturer  TEXT,
  replacement_model         TEXT,
  replacement_spec          TEXT,
  replacement_part_no       TEXT,
  critical_level            TEXT NOT NULL DEFAULT 'normal',
  status                    TEXT NOT NULL DEFAULT 'active',
  note                      TEXT,
  normalized_search         TEXT,
  created_by                TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_equipment_client
  ON client_equipment(client_id);
CREATE INDEX IF NOT EXISTS idx_client_equipment_group
  ON client_equipment(equipment_group);
CREATE INDEX IF NOT EXISTS idx_client_equipment_oem
  ON client_equipment(oem_manufacturer);
CREATE INDEX IF NOT EXISTS idx_client_equipment_replacement
  ON client_equipment(replacement_manufacturer);
CREATE INDEX IF NOT EXISTS idx_client_equipment_search
  ON client_equipment(normalized_search);
