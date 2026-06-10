export async function listSuppliersSQL(db, { q, cursor, limit }) {
  const binds = [];
  const where = [];
  if (q) {
    where.push('(normalized_search LIKE ? OR supplier_name LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (cursor) {
    where.push('supplier_id > ?');
    binds.push(cursor);
  }
  const res = await db.prepare(
    `SELECT * FROM suppliers ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY supplier_id ASC LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const rows = res.results || [];
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit, nextCursor: rows.length > limit ? rows[limit - 1].supplier_id : null };
}

export async function getSupplierSQL(db, id) {
  return db.prepare('SELECT * FROM suppliers WHERE supplier_id = ?').bind(id).first();
}

export async function insertSupplierSQL(db, row) {
  return db.prepare(
    `INSERT INTO suppliers (supplier_id, supplier_name, supplier_type, country, contact_name, email, phone, zalo, wechat, note, normalized_search, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.supplier_id, row.supplier_name, row.supplier_type, row.country, row.contact_name, row.email, row.phone, row.zalo, row.wechat, row.note, row.normalized_search, row.created_at, row.updated_at).run();
}

export async function updateSupplierSQL(db, row) {
  return db.prepare(
    `UPDATE suppliers SET supplier_name = ?, supplier_type = ?, country = ?, contact_name = ?, email = ?, phone = ?,
       zalo = ?, wechat = ?, note = ?, normalized_search = ?, updated_at = ?
     WHERE supplier_id = ?`
  ).bind(row.supplier_name, row.supplier_type, row.country, row.contact_name, row.email, row.phone, row.zalo, row.wechat, row.note, row.normalized_search, row.updated_at, row.supplier_id).run();
}
