function parseCursor(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf('|||');
  return idx === -1 ? { pk: cursor, sortVal: undefined } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}

const ACCOUNT_SORT = {
  username:     { col: 'username',     rowKey: 'username',     type: 'text' },
  display_name: { col: 'display_name', rowKey: 'display_name', type: 'text' },
  role:         { col: 'role',         rowKey: 'role',         type: 'text' },
  status:       { col: 'status',       rowKey: 'status',       type: 'text' },
};

export async function getUserByUsernameSQL(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
}

export async function getUserByIdSQL(db, userId) {
  return db.prepare('SELECT * FROM users WHERE user_id = ?').bind(userId).first();
}

export async function listUsersSQL(db, { limit, cursor, sortBy, sortDir }) {
  const sort = ACCOUNT_SORT[sortBy] || null;
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const op  = dir === 'ASC' ? '>' : '<';

  const binds = [];
  const where = [];
  if (cursor) {
    const c = parseCursor(cursor);
    if (!sort || c.sortVal === undefined) {
      where.push('user_id > ?'); binds.push(c.pk);
    } else {
      const wrap = `COALESCE(${sort.col}, '')`;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND user_id ${op} ?))`);
      binds.push(c.sortVal, c.sortVal, c.pk);
    }
  }

  const orderBy = sort ? `${sort.col} ${dir}, user_id ${dir}` : 'user_id ASC';
  const res = await db.prepare(
    `SELECT user_id, username, display_name, role, status, session_version, created_at, updated_at
     FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit + 1).all();

  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = sort ? String(last[sort.rowKey] ?? '') + '|||' + last.user_id : last.user_id;
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor };
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
