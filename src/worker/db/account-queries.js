export async function getUserByUsernameSQL(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
}

export async function getUserByIdSQL(db, userId) {
  return db.prepare('SELECT * FROM users WHERE user_id = ?').bind(userId).first();
}

export async function listUsersSQL(db, { limit, cursor }) {
  const binds = [];
  const where = [];
  if (cursor) {
    where.push('user_id > ?');
    binds.push(cursor);
  }
  const res = await db.prepare(
    `SELECT user_id, username, display_name, role, status, session_version, created_at, updated_at
     FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY user_id ASC LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const rows = res.results || [];
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit, nextCursor: rows.length > limit ? rows[limit - 1].user_id : null };
}

export async function insertUserSQL(db, row) {
  return db.prepare(
    `INSERT INTO users (user_id, username, display_name, password_hash, role, status, session_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.user_id, row.username, row.display_name, row.password_hash, row.role, row.status, row.session_version, row.created_at, row.updated_at).run();
}

export async function updateUserSQL(db, row) {
  return db.prepare(
    `UPDATE users SET display_name = ?, role = ?, status = ?, session_version = session_version + ?, updated_at = ?
     WHERE user_id = ?`
  ).bind(row.display_name, row.role, row.status, row.bump_session || 0, row.updated_at, row.user_id).run();
}

export async function updatePasswordSQL(db, userId, passwordHash, updatedAt) {
  return db.prepare(
    'UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE user_id = ?'
  ).bind(passwordHash, updatedAt, userId).run();
}
