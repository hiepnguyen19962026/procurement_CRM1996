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

export async function nextEntitySequenceSQL(db, sequenceKey, seedValue = 0) {
  try {
    await db.prepare(
      'INSERT OR IGNORE INTO entity_sequences (sequence_key, last_value) VALUES (?, ?)'
    ).bind(sequenceKey, seedValue).run();
    return db.prepare(
      'UPDATE entity_sequences SET last_value = last_value + 1, updated_at = CURRENT_TIMESTAMP WHERE sequence_key = ? RETURNING last_value'
    ).bind(sequenceKey).first();
  } catch (err) {
    if (String(err?.message || err).includes('entity_sequences')) {
      throw new Error('Migration required: run 044_entity_sequences.sql before creating human-readable IDs.');
    }
    throw err;
  }
}
