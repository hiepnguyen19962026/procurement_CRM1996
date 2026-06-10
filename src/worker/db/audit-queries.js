function parseCursor(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf('|||');
  return idx === -1 ? { pk: cursor, sortVal: undefined } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}

const AUDIT_SORT = {
  created_at:  { col: 'created_at',  rowKey: 'created_at',  type: 'text' },
  actor_name:  { col: 'actor_name',  rowKey: 'actor_name',  type: 'text' },
  action:      { col: 'action',      rowKey: 'action',      type: 'text' },
};

export async function insertAuditLogSQL(db, row) {
  return db.prepare(
    `INSERT INTO audit_logs (audit_id, action, entity_type, entity_id, message, old_json, new_json, actor_id, actor_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.audit_id, row.action, row.entity_type, row.entity_id, row.message, row.old_json, row.new_json, row.actor_id, row.actor_name, row.created_at).run();
}

export async function listAuditLogsSQL(db, { q, cursor, sortBy, sortDir, limit }) {
  const sort = AUDIT_SORT[sortBy] || null;
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const op  = dir === 'ASC' ? '>' : '<';

  const binds = [];
  const where = [];
  if (q) {
    where.push('(message LIKE ? OR action LIKE ? OR entity_id LIKE ? OR actor_name LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (cursor) {
    const c = parseCursor(cursor);
    if (!sort || c.sortVal === undefined) {
      where.push(`audit_id ${op} ?`); binds.push(c.pk);
    } else {
      const wrap = `COALESCE(${sort.col}, '')`;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND audit_id ${op} ?))`);
      binds.push(c.sortVal, c.sortVal, c.pk);
    }
  }

  const orderBy = sort ? `${sort.col} ${dir}, audit_id ${dir}` : 'audit_id DESC';
  const res = await db.prepare(
    `SELECT * FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit + 1).all();

  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = sort ? String(last[sort.rowKey] ?? '') + '|||' + last.audit_id : last.audit_id;
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor };
}
