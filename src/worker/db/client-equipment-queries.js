export async function listClientEquipmentSQL(db, { clientId, q, limit }) {
  const binds = [clientId];
  let where = 'client_id = ?';
  if (q) {
    where += ' AND normalized_search LIKE ?';
    binds.push(`%${q}%`);
  }
  const lim = Math.min(Number(limit) || 200, 500);
  const res = await db.prepare(
    `SELECT * FROM client_equipment WHERE ${where} ORDER BY equipment_group ASC, equipment_name ASC LIMIT ?`
  ).bind(...binds, lim).all();
  return { rows: res.results || [] };
}

export async function getClientEquipmentSQL(db, id) {
  return db.prepare('SELECT * FROM client_equipment WHERE equipment_id = ?').bind(id).first();
}

export async function insertClientEquipmentSQL(db, row) {
  return db.prepare(
    `INSERT INTO client_equipment (
      equipment_id, client_id, plant_name, unit_no, system_area,
      equipment_group, equipment_name, equipment_tag,
      oem_manufacturer, oem_model, oem_spec, oem_part_no,
      replacement_manufacturer, replacement_model, replacement_spec, replacement_part_no,
      critical_level, status, note, normalized_search,
      created_by, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.equipment_id, row.client_id, row.plant_name, row.unit_no, row.system_area,
    row.equipment_group, row.equipment_name, row.equipment_tag,
    row.oem_manufacturer, row.oem_model, row.oem_spec, row.oem_part_no,
    row.replacement_manufacturer, row.replacement_model, row.replacement_spec, row.replacement_part_no,
    row.critical_level, row.status, row.note, row.normalized_search,
    row.created_by, row.created_at, row.updated_at
  ).run();
}

export async function updateClientEquipmentSQL(db, row) {
  return db.prepare(
    `UPDATE client_equipment SET
      plant_name=?, unit_no=?, system_area=?,
      equipment_group=?, equipment_name=?, equipment_tag=?,
      oem_manufacturer=?, oem_model=?, oem_spec=?, oem_part_no=?,
      replacement_manufacturer=?, replacement_model=?, replacement_spec=?, replacement_part_no=?,
      critical_level=?, status=?, note=?, normalized_search=?, updated_at=?
     WHERE equipment_id=?`
  ).bind(
    row.plant_name, row.unit_no, row.system_area,
    row.equipment_group, row.equipment_name, row.equipment_tag,
    row.oem_manufacturer, row.oem_model, row.oem_spec, row.oem_part_no,
    row.replacement_manufacturer, row.replacement_model, row.replacement_spec, row.replacement_part_no,
    row.critical_level, row.status, row.note, row.normalized_search, row.updated_at,
    row.equipment_id
  ).run();
}

export async function archiveClientEquipmentSQL(db, id, updatedAt) {
  return db.prepare(
    `UPDATE client_equipment SET status = 'archived', updated_at = ? WHERE equipment_id = ?`
  ).bind(updatedAt, id).run();
}
