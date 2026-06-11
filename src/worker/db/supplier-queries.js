function parseCursor(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf('|||');
  return idx === -1 ? { pk: cursor, sortVal: undefined } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}

const SUPPLIER_SORT = {
  supplier_id:   { col: 'supplier_id',   rowKey: 'supplier_id',   type: 'text' },
  supplier_name: { col: 'supplier_name', rowKey: 'supplier_name', type: 'text' },
  supplier_type: { col: 'supplier_type', rowKey: 'supplier_type', type: 'text' },
  country:       { col: 'country',       rowKey: 'country',       type: 'text' },
};

export async function listSuppliersSQL(db, { q, cursor, sortBy, sortDir, limit }) {
  const sort = SUPPLIER_SORT[sortBy] || null;
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const op  = dir === 'ASC' ? '>' : '<';

  const binds = [];
  const where = ['deleted_at IS NULL'];
  if (q) {
    where.push('(normalized_search LIKE ? OR supplier_name LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (cursor) {
    const c = parseCursor(cursor);
    if (!sort || c.sortVal === undefined) {
      where.push('supplier_id > ?'); binds.push(c.pk);
    } else {
      const wrap = `COALESCE(${sort.col}, '')`;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND supplier_id ${op} ?))`);
      binds.push(c.sortVal, c.sortVal, c.pk);
    }
  }

  const orderBy = sort ? `${sort.col} ${dir}, supplier_id ${dir}` : 'supplier_id ASC';
  const res = await db.prepare(
    `SELECT * FROM suppliers ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit + 1).all();

  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = sort ? String(last[sort.rowKey] ?? '') + '|||' + last.supplier_id : last.supplier_id;
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor };
}

export async function archiveSupplierSQL(db, supplierId, now) {
  return db.prepare('UPDATE suppliers SET deleted_at = ? WHERE supplier_id = ?')
    .bind(now, supplierId).run();
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
