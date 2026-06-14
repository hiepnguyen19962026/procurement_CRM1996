const DELIVERY_SORT_EXPR = 'dn.delivery_date';

// deliveryDate: 'YYYY-MM-DD', noteType: 'delivery' | 'return'
// DGH-2026-0614-001 (delivery) / DTH-2026-0614-001 (return)
// Sequence resets per day + note_type. Relies on UNIQUE delivery_note_no — caller retries on conflict.
export async function nextDeliveryNoteNoSQL(db, deliveryDate, noteType) {
  const d = String(deliveryDate || '');
  const year = d.slice(0, 4) || String(new Date().getUTCFullYear());
  const mmdd = d.replace(/-/g, '').slice(4, 8) || (() => {
    const n = new Date();
    return String(n.getUTCMonth() + 1).padStart(2, '0') + String(n.getUTCDate()).padStart(2, '0');
  })();
  const code   = noteType === 'return' ? 'DTH' : 'DGH';
  const prefix = `${code}-${year}-${mmdd}-`;
  const row = await db.prepare(
    `SELECT delivery_note_no FROM delivery_notes
     WHERE delivery_note_no LIKE ?
     ORDER BY delivery_note_no DESC LIMIT 1`
  ).bind(`${prefix}%`).first();
  const last = row?.delivery_note_no ? Number(String(row.delivery_note_no).split('-').pop()) : 0;
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(3, '0')}`;
}

export async function listDeliveryNotesSQL(db, params) {
  const { q, rfqId, contractId, clientId, noteType, status, dateFrom, dateTo, cursorDate, cursorId, limit } = params;
  const conds = [];
  const binds = [];

  if (rfqId)      { conds.push('dn.rfq_id = ?');       binds.push(rfqId); }
  if (contractId) { conds.push('dn.contract_id = ?');  binds.push(contractId); }
  if (clientId)   { conds.push('dn.client_id = ?');    binds.push(clientId); }
  if (noteType)   { conds.push('dn.note_type = ?');    binds.push(noteType); }
  if (status)     { conds.push('dn.status = ?');       binds.push(status); }
  if (dateFrom)   { conds.push(`${DELIVERY_SORT_EXPR} >= ?`); binds.push(dateFrom); }
  if (dateTo)     { conds.push(`${DELIVERY_SORT_EXPR} <= ?`); binds.push(dateTo); }
  if (q) {
    const like = `%${q}%`;
    conds.push('(dn.delivery_note_no LIKE ? OR dn.receiver_unit LIKE ? OR dn.sender_unit LIKE ? OR dn.note LIKE ? OR c.contract_no LIKE ? OR r.ten_goi LIKE ?)');
    binds.push(like, like, like, like, like, like);
  }
  if (cursorDate && cursorId) {
    conds.push(`(${DELIVERY_SORT_EXPR} < ? OR (${DELIVERY_SORT_EXPR} = ? AND dn.delivery_note_id < ?))`);
    binds.push(cursorDate, cursorDate, cursorId);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const res = await db.prepare(
    `SELECT dn.*,
            r.ma_goi_tbmt, r.ten_goi,
            c.contract_no, c.contract_name,
            cl.client_name,
            COALESCE(SUM(CASE WHEN dni.status = 'active' THEN dni.delivered_quantity ELSE 0 END), 0) AS delivered_quantity_total,
            COUNT(CASE WHEN dni.status = 'active' THEN 1 END) AS item_count
     FROM delivery_notes dn
     LEFT JOIN rfqs r ON r.rfq_id = dn.rfq_id
     LEFT JOIN contracts c ON c.contract_id = dn.contract_id
     LEFT JOIN clients cl ON cl.client_id = dn.client_id
     LEFT JOIN delivery_note_items dni ON dni.delivery_note_id = dn.delivery_note_id
     ${where}
     GROUP BY dn.delivery_note_id
     ORDER BY dn.delivery_date DESC, dn.delivery_note_id DESC
     LIMIT ?`
  ).bind(...binds, limit).all();
  return res.results || [];
}

export async function getDeliveryNoteSQL(db, deliveryNoteId) {
  return db.prepare(
    `SELECT dn.*, r.ma_goi_tbmt, r.ten_goi, c.contract_no, c.contract_name, cl.client_name
     FROM delivery_notes dn
     LEFT JOIN rfqs r ON r.rfq_id = dn.rfq_id
     LEFT JOIN contracts c ON c.contract_id = dn.contract_id
     LEFT JOIN clients cl ON cl.client_id = dn.client_id
     WHERE dn.delivery_note_id = ?`
  ).bind(deliveryNoteId).first();
}

export async function getDeliveryNoteItemsSQL(db, deliveryNoteId) {
  const res = await db.prepare(
    `SELECT dni.*, ci.contract_quantity, ci.contract_unit_price, ci.contract_line_total
     FROM delivery_note_items dni
     LEFT JOIN contract_items ci ON ci.contract_item_id = dni.contract_item_id
     WHERE dni.delivery_note_id = ?
     ORDER BY dni.created_at ASC, dni.delivery_note_item_id ASC`
  ).bind(deliveryNoteId).all();
  return res.results || [];
}

export async function getDeliveryItemsForRfqItemSQL(db, rfqItemId) {
  const res = await db.prepare(
    `SELECT dni.*, dn.delivery_note_no, dn.delivery_date, dn.receiver_unit, dn.sender_unit,
            dn.status AS delivery_note_status, dn.contract_id, c.contract_no
     FROM delivery_note_items dni
     JOIN delivery_notes dn ON dn.delivery_note_id = dni.delivery_note_id
     LEFT JOIN contracts c ON c.contract_id = dn.contract_id
     WHERE dni.rfq_item_id = ?
     ORDER BY dn.delivery_date DESC, dn.delivery_note_id DESC, dni.created_at DESC
     LIMIT 50`
  ).bind(rfqItemId).all();
  return res.results || [];
}

export async function getDeliveryNoteItemSQL(db, deliveryNoteItemId) {
  return db.prepare('SELECT * FROM delivery_note_items WHERE delivery_note_item_id = ?')
    .bind(deliveryNoteItemId).first();
}

export async function insertDeliveryNoteSQL(db, row) {
  return db.prepare(
    `INSERT INTO delivery_notes (
      delivery_note_id, delivery_note_no, note_type, rfq_id, contract_id, client_id,
      delivery_date, receiver_unit, sender_unit, receiver_name, sender_name,
      note, status, created_by, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.delivery_note_id, row.delivery_note_no, row.note_type,
    row.rfq_id, row.contract_id, row.client_id,
    row.delivery_date, row.receiver_unit, row.sender_unit, row.receiver_name, row.sender_name,
    row.note, row.status, row.created_by, row.created_at, row.updated_at, row.archived_at
  ).run();
}

export async function updateDeliveryNoteSQL(db, row) {
  return db.prepare(
    `UPDATE delivery_notes SET
      rfq_id = ?, contract_id = ?, client_id = ?, delivery_date = ?,
      receiver_unit = ?, sender_unit = ?, receiver_name = ?, sender_name = ?,
      note = ?, updated_at = ?
     WHERE delivery_note_id = ? AND status = 'active'`
  ).bind(
    row.rfq_id, row.contract_id, row.client_id, row.delivery_date,
    row.receiver_unit, row.sender_unit, row.receiver_name, row.sender_name,
    row.note, row.updated_at,
    row.delivery_note_id
  ).run();
}

export async function archiveDeliveryNoteSQL(db, deliveryNoteId, now) {
  return db.prepare(
    `UPDATE delivery_notes SET status = 'archived', archived_at = ?, updated_at = ?
     WHERE delivery_note_id = ? AND status = 'active'`
  ).bind(now, now, deliveryNoteId).run();
}

export async function insertDeliveryNoteItemSQL(db, row) {
  return db.prepare(
    `INSERT INTO delivery_note_items (
      delivery_note_item_id, delivery_note_id, rfq_item_id, contract_item_id, item_id,
      line_no, ma_vat_tu, ten_vat_tu, required_model, manufacturer, brand,
      origin_country, unit, delivered_quantity, note, status,
      created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.delivery_note_item_id, row.delivery_note_id, row.rfq_item_id, row.contract_item_id, row.item_id,
    row.line_no, row.ma_vat_tu, row.ten_vat_tu, row.required_model, row.manufacturer, row.brand,
    row.origin_country, row.unit, row.delivered_quantity, row.note, row.status,
    row.created_at, row.updated_at, row.archived_at
  ).run();
}

export async function updateDeliveryNoteItemSQL(db, row) {
  return db.prepare(
    `UPDATE delivery_note_items SET
      contract_item_id = ?, item_id = ?, line_no = ?, ma_vat_tu = ?, ten_vat_tu = ?,
      required_model = ?, manufacturer = ?, brand = ?, origin_country = ?, unit = ?,
      delivered_quantity = ?, note = ?, updated_at = ?
     WHERE delivery_note_item_id = ? AND status = 'active'`
  ).bind(
    row.contract_item_id, row.item_id, row.line_no, row.ma_vat_tu, row.ten_vat_tu,
    row.required_model, row.manufacturer, row.brand, row.origin_country, row.unit,
    row.delivered_quantity, row.note, row.updated_at,
    row.delivery_note_item_id
  ).run();
}

export async function archiveDeliveryNoteItemSQL(db, deliveryNoteItemId, now) {
  return db.prepare(
    `UPDATE delivery_note_items SET status = 'archived', archived_at = ?, updated_at = ?
     WHERE delivery_note_item_id = ? AND status = 'active'`
  ).bind(now, now, deliveryNoteItemId).run();
}
