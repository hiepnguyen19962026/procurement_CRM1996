export async function insertAuditLogSQL(db, row) {
  return db.prepare(
    `INSERT INTO audit_logs (audit_id, action, entity_type, entity_id, message, old_json, new_json, actor_id, actor_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.audit_id, row.action, row.entity_type, row.entity_id, row.message, row.old_json, row.new_json, row.actor_id, row.actor_name, row.created_at).run();
}

export async function listAuditLogsSQL(db, { q, cursor, limit }) {
  const binds = [];
  const where = [];
  if (q) {
    where.push('(message LIKE ? OR action LIKE ? OR entity_id LIKE ? OR actor_name LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (cursor) {
    where.push('audit_id < ?');
    binds.push(cursor);
  }
  const res = await db.prepare(
    `SELECT * FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC, audit_id DESC LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const rows = res.results || [];
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit, nextCursor: rows.length > limit ? rows[limit - 1].audit_id : null };
}
