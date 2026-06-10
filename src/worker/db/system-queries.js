export async function getActorSessionSQL(db, userId) {
  return db.prepare(
    'SELECT user_id, role, status, session_version FROM users WHERE user_id = ?'
  ).bind(userId).first();
}

export async function getLastEntityIdSQL(db, table, idCol, likePattern) {
  return db.prepare(
    `SELECT ${idCol} AS id FROM ${table} WHERE ${idCol} LIKE ? ORDER BY ${idCol} DESC LIMIT 1`
  ).bind(likePattern).first();
}
