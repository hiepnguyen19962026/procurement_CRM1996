export async function listClientsSQL(db, { q, cursor, limit }) {
  const binds = [];
  const where = [];
  if (q) {
    where.push('(normalized_search LIKE ? OR client_name LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (cursor) {
    where.push('client_id > ?');
    binds.push(cursor);
  }
  const res = await db.prepare(
    `SELECT * FROM clients ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY client_id ASC LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const rows = res.results || [];
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit, nextCursor: rows.length > limit ? rows[limit - 1].client_id : null };
}

export async function getClientSQL(db, id) {
  return db.prepare('SELECT * FROM clients WHERE client_id = ?').bind(id).first();
}

export async function insertClientSQL(db, row) {
  return db.prepare(
    `INSERT INTO clients (client_id, client_name, plant_name, province, note, normalized_search, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.client_id, row.client_name, row.plant_name, row.province, row.note, row.normalized_search, row.created_at, row.updated_at).run();
}

export async function updateClientSQL(db, row) {
  return db.prepare(
    `UPDATE clients SET client_name = ?, plant_name = ?, province = ?, note = ?, normalized_search = ?, updated_at = ?
     WHERE client_id = ?`
  ).bind(row.client_name, row.plant_name, row.province, row.note, row.normalized_search, row.updated_at, row.client_id).run();
}
