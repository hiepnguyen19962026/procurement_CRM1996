function parseCursor(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf('|||');
  return idx === -1 ? { pk: cursor, sortVal: undefined } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}

const CLIENT_SORT = {
  client_id:   { col: 'client_id',   rowKey: 'client_id',   type: 'text' },
  client_name: { col: 'client_name', rowKey: 'client_name', type: 'text' },
  plant_name:  { col: 'plant_name',  rowKey: 'plant_name',  type: 'text' },
  province:    { col: 'province',    rowKey: 'province',    type: 'text' },
};

export async function listClientsSQL(db, { q, cursor, sortBy, sortDir, limit }) {
  const sort = CLIENT_SORT[sortBy] || null;
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const op  = dir === 'ASC' ? '>' : '<';

  const binds = [];
  const where = ['deleted_at IS NULL'];
  if (q) {
    // LIKE on client_id: SQLite LIKE is case-insensitive for ASCII, so 'cl-2026%' matches 'CL-2026-00001'
    where.push('(normalized_search LIKE ? OR client_name LIKE ? OR client_id LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`, `${q}%`);
  }
  if (cursor) {
    const c = parseCursor(cursor);
    if (!sort || c.sortVal === undefined) {
      // default ASC by client_id
      where.push('client_id > ?'); binds.push(c.pk);
    } else {
      const wrap = `COALESCE(${sort.col}, '')`;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND client_id ${op} ?))`);
      binds.push(c.sortVal, c.sortVal, c.pk);
    }
  }

  const orderBy = sort ? `${sort.col} ${dir}, client_id ${dir}` : 'client_id ASC';
  const res = await db.prepare(
    `SELECT * FROM clients ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit + 1).all();

  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = sort ? String(last[sort.rowKey] ?? '') + '|||' + last.client_id : last.client_id;
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor };
}

export async function archiveClientSQL(db, clientId, now) {
  return db.prepare('UPDATE clients SET deleted_at = ? WHERE client_id = ?')
    .bind(now, clientId).run();
}

export async function getClientSQL(db, id) {
  return db.prepare('SELECT * FROM clients WHERE client_id = ?').bind(id).first();
}

export async function insertClientSQL(db, row) {
  return db.prepare(
    `INSERT INTO clients (
      client_id, client_name, plant_name, province, note,
      tax_code, legal_name, client_type, address, email, phone, website,
      normalized_search, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.client_id, row.client_name, row.plant_name, row.province, row.note,
    row.tax_code, row.legal_name, row.client_type, row.address, row.email, row.phone, row.website,
    row.normalized_search, row.created_at, row.updated_at
  ).run();
}

export async function updateClientSQL(db, row) {
  return db.prepare(
    `UPDATE clients SET
      client_name=?, plant_name=?, province=?, note=?,
      tax_code=?, legal_name=?, client_type=?, address=?, email=?, phone=?, website=?,
      normalized_search=?, updated_at=?
     WHERE client_id=?`
  ).bind(
    row.client_name, row.plant_name, row.province, row.note,
    row.tax_code, row.legal_name, row.client_type, row.address, row.email, row.phone, row.website,
    row.normalized_search, row.updated_at, row.client_id
  ).run();
}
