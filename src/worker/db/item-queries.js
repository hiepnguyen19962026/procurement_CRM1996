export async function searchItemsSQL(db, params) {
  const { q, maVatTu, status, cursorUpdatedAt, cursorItemId, limit } = params;
  const conds = [];
  const binds = [];

  if (status) {
    conds.push('status = ?');
    binds.push(status);
  }
  if (maVatTu) {
    conds.push('ma_vat_tu = ?');
    binds.push(maVatTu);
  }
  if (q) {
    const like = `%${q}%`;
    conds.push('(normalized_search LIKE ? OR ma_vat_tu LIKE ? OR ten_vat_tu LIKE ? OR required_model LIKE ? OR manufacturer LIKE ? OR brand LIKE ?)');
    binds.push(like, like, like, like, like, like);
  }
  if (cursorUpdatedAt && cursorItemId) {
    conds.push('(updated_at < ? OR (updated_at = ? AND item_id < ?))');
    binds.push(cursorUpdatedAt, cursorUpdatedAt, cursorItemId);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const res = await db.prepare(
    `SELECT *
     FROM items
     ${where}
     ORDER BY updated_at DESC, item_id DESC
     LIMIT ?`
  ).bind(...binds, limit).all();
  return res.results || [];
}

export async function getItemSQL(db, itemId) {
  return db.prepare('SELECT * FROM items WHERE item_id = ?').bind(itemId).first();
}

export async function getItemDetailSQL(db, itemId) {
  const item = await getItemSQL(db, itemId);
  if (!item) return null;
  const linked = await db.prepare(
    `SELECT COUNT(*) AS linked_count
     FROM rfq_items
     WHERE item_id = ?`
  ).bind(itemId).first();
  const quotes = await db.prepare(
    `SELECT COUNT(*) AS quote_count
     FROM supplier_quotes sq
     JOIN rfq_items ri ON ri.rfq_item_id = sq.rfq_item_id
     WHERE ri.item_id = ?`
  ).bind(itemId).first();
  return {
    ...item,
    linked_rfq_item_count: Number(linked?.linked_count || 0),
    quote_count: Number(quotes?.quote_count || 0),
  };
}

export async function insertItemSQL(db, row) {
  return db.prepare(
    `INSERT INTO items (
      item_id, ma_vat_tu, ten_vat_tu, required_model, manufacturer, brand,
      origin_country, unit, technical_params, note, normalized_search, status,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.item_id, row.ma_vat_tu, row.ten_vat_tu, row.required_model, row.manufacturer, row.brand,
    row.origin_country, row.unit, row.technical_params, row.note, row.normalized_search, row.status,
    row.created_by, row.created_at, row.updated_at
  ).run();
}

export async function updateItemSQL(db, row) {
  return db.prepare(
    `UPDATE items SET
      ma_vat_tu = ?, ten_vat_tu = ?, required_model = ?, manufacturer = ?, brand = ?,
      origin_country = ?, unit = ?, technical_params = ?, note = ?, normalized_search = ?,
      status = ?, updated_at = ?
     WHERE item_id = ?`
  ).bind(
    row.ma_vat_tu, row.ten_vat_tu, row.required_model, row.manufacturer, row.brand,
    row.origin_country, row.unit, row.technical_params, row.note, row.normalized_search,
    row.status, row.updated_at, row.item_id
  ).run();
}

export async function linkRfqItemToItemSQL(db, rfqItemId, itemId, updatedAt) {
  return db.prepare(
    `UPDATE rfq_items
     SET item_id = ?, updated_at = ?
     WHERE rfq_item_id = ?`
  ).bind(itemId, updatedAt, rfqItemId).run();
}

export async function unlinkRfqItemFromItemSQL(db, rfqItemId, updatedAt) {
  return db.prepare(
    `UPDATE rfq_items
     SET item_id = NULL, updated_at = ?
     WHERE rfq_item_id = ?`
  ).bind(updatedAt, rfqItemId).run();
}

export async function suggestItemsSQL(db, params) {
  const { maVatTu, normalizedNeedle, nameLike, modelLike, manufacturerLike, brandLike, originLike, unitLike, limit } = params;
  const conds = [];
  const binds = [];

  if (maVatTu) {
    conds.push('ma_vat_tu = ?');
    binds.push(maVatTu);
  }
  if (normalizedNeedle) {
    conds.push('normalized_search LIKE ?');
    binds.push(`%${normalizedNeedle}%`);
  }
  if (nameLike) {
    conds.push('ten_vat_tu LIKE ?');
    binds.push(`%${nameLike}%`);
  }
  if (modelLike) {
    conds.push('required_model LIKE ?');
    binds.push(`%${modelLike}%`);
  }
  if (manufacturerLike) {
    conds.push('manufacturer LIKE ?');
    binds.push(`%${manufacturerLike}%`);
  }
  if (brandLike) {
    conds.push('brand LIKE ?');
    binds.push(`%${brandLike}%`);
  }
  if (originLike) {
    conds.push('origin_country LIKE ?');
    binds.push(`%${originLike}%`);
  }
  if (unitLike) {
    conds.push('unit = ?');
    binds.push(unitLike);
  }

  if (!conds.length) return [];

  const exactCode = maVatTu || '';
  const searchLike = normalizedNeedle ? `%${normalizedNeedle}%` : '';
  const res = await db.prepare(
    `SELECT *,
       CASE WHEN ma_vat_tu != '' AND ma_vat_tu = ? THEN 100 ELSE 0 END
       + CASE WHEN ? != '' AND normalized_search LIKE ? THEN 30 ELSE 0 END
       + CASE WHEN ? != '' AND ten_vat_tu LIKE ? THEN 15 ELSE 0 END
       + CASE WHEN ? != '' AND required_model LIKE ? THEN 12 ELSE 0 END
       + CASE WHEN ? != '' AND manufacturer LIKE ? THEN 8 ELSE 0 END
       + CASE WHEN ? != '' AND brand LIKE ? THEN 6 ELSE 0 END AS match_score
     FROM items
     WHERE status = ? AND (${conds.join(' OR ')})
     ORDER BY match_score DESC, updated_at DESC, item_id DESC
     LIMIT ?`
  ).bind(
    exactCode,
    searchLike, searchLike,
    nameLike || '', `%${nameLike || ''}%`,
    modelLike || '', `%${modelLike || ''}%`,
    manufacturerLike || '', `%${manufacturerLike || ''}%`,
    brandLike || '', `%${brandLike || ''}%`,
    'active',
    ...binds,
    limit
  ).all();
  return res.results || [];
}
