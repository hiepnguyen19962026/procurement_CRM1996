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
            COALESCE(SUM(CASE WHEN dni.status = 'active' THEN dni.accepted_quantity  ELSE 0 END), 0) AS accepted_quantity_total,
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
    `WITH cumulative AS (
       SELECT x.rfq_item_id,
              COALESCE(SUM(x.delivered_quantity), 0) AS cumulative_delivered_qty
       FROM delivery_note_items x
       JOIN delivery_notes xdn ON xdn.delivery_note_id = x.delivery_note_id
       WHERE x.rfq_item_id IN (SELECT rfq_item_id FROM delivery_note_items WHERE delivery_note_id = ?)
         AND x.status = 'active' AND xdn.status = 'active'
       GROUP BY x.rfq_item_id
     ),
     clar_ranked AS (
       SELECT tc.rfq_item_id, tc.title,
              COUNT(*) OVER (PARTITION BY tc.rfq_item_id) AS clarification_count,
              ROW_NUMBER() OVER (PARTITION BY tc.rfq_item_id ORDER BY tc.created_at DESC, tc.sequence_no DESC) AS rn
       FROM technical_clarifications tc
       WHERE tc.deleted_at IS NULL
         AND tc.rfq_item_id IN (SELECT rfq_item_id FROM delivery_note_items WHERE delivery_note_id = ?)
     ),
     clar_summary AS (
       SELECT rfq_item_id, title AS latest_clarification_title, clarification_count
       FROM clar_ranked WHERE rn = 1
     )
     SELECT dni.*,
            ci.contract_quantity, ci.contract_unit_price, ci.contract_line_total,
            ci.delivery_deadline_date,
            ri.stt_goc, ri.hang_final, ri.quy_cach_final, ri.vat_lieu, ri.thong_so_ky_thuat,
            COALESCE(cu.cumulative_delivered_qty, 0) AS cumulative_delivered_qty,
            COALESCE(cs.clarification_count, 0)      AS clarification_count,
            cs.latest_clarification_title
     FROM delivery_note_items dni
     LEFT JOIN contract_items ci  ON ci.contract_item_id = dni.contract_item_id
     LEFT JOIN rfq_items ri       ON ri.rfq_item_id      = dni.rfq_item_id
     LEFT JOIN cumulative cu      ON cu.rfq_item_id      = dni.rfq_item_id
     LEFT JOIN clar_summary cs    ON cs.rfq_item_id      = dni.rfq_item_id
     WHERE dni.delivery_note_id = ?
     ORDER BY dni.created_at ASC, dni.delivery_note_item_id ASC`
  ).bind(deliveryNoteId, deliveryNoteId, deliveryNoteId).all();
  return res.results || [];
}

// Lightweight: only statuses + accepted_qty — used by recordAcceptance to compute header from ALL items.
export async function getDeliveryNoteItemStatusesSQL(db, deliveryNoteId) {
  const res = await db.prepare(
    `SELECT delivery_note_item_id, acceptance_status, accepted_quantity
     FROM delivery_note_items
     WHERE delivery_note_id = ? AND status = 'active'`
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
      vehicle_no, note, status, created_by, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.delivery_note_id, row.delivery_note_no, row.note_type,
    row.rfq_id, row.contract_id, row.client_id,
    row.delivery_date, row.receiver_unit, row.sender_unit, row.receiver_name, row.sender_name,
    row.vehicle_no, row.note, row.status, row.created_by, row.created_at, row.updated_at, row.archived_at
  ).run();
}

export async function updateDeliveryNoteSQL(db, row) {
  return db.prepare(
    `UPDATE delivery_notes SET
      rfq_id = ?, contract_id = ?, client_id = ?, delivery_date = ?,
      receiver_unit = ?, sender_unit = ?, receiver_name = ?, sender_name = ?,
      vehicle_no = ?, note = ?, updated_at = ?
     WHERE delivery_note_id = ? AND status = 'active'`
  ).bind(
    row.rfq_id, row.contract_id, row.client_id, row.delivery_date,
    row.receiver_unit, row.sender_unit, row.receiver_name, row.sender_name,
    row.vehicle_no, row.note, row.updated_at,
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

// Update acceptance header + all item rows in one batch.
// header: { acceptance_date, acceptance_status, acceptance_note, payment_request_status, payment_request_date }
// itemRows: [{ delivery_note_item_id, accepted_quantity, acceptance_status, rejection_reason, warranty_days, warranty_start_date, warranty_end_date }]
export async function recordAcceptanceSQL(db, noteId, header, itemRows, now) {
  const stmts = [
    db.prepare(
      `UPDATE delivery_notes SET
         acceptance_date = ?, acceptance_status = ?, acceptance_note = ?,
         payment_request_status = ?, payment_request_date = ?,
         updated_at = ?
       WHERE delivery_note_id = ? AND status = 'active'`
    ).bind(
      header.acceptance_date, header.acceptance_status, header.acceptance_note,
      header.payment_request_status, header.payment_request_date,
      now, noteId
    ),
  ];
  for (const it of itemRows) {
    stmts.push(
      db.prepare(
        `UPDATE delivery_note_items SET
           accepted_quantity = ?, acceptance_status = ?, rejection_reason = ?,
           warranty_days = ?, warranty_start_date = ?, warranty_end_date = ?,
           updated_at = ?
         WHERE delivery_note_item_id = ? AND delivery_note_id = ? AND status = 'active'`
      ).bind(
        it.accepted_quantity, it.acceptance_status, it.rejection_reason,
        it.warranty_days, it.warranty_start_date, it.warranty_end_date,
        now, it.delivery_note_item_id, noteId
      )
    );
  }
  return db.batch(stmts);
}

// Hard delete — admin only, after safety check in handler.
export async function deleteDeliveryNoteSQL(db, deliveryNoteId) {
  return db.batch([
    db.prepare('DELETE FROM delivery_note_items WHERE delivery_note_id = ?').bind(deliveryNoteId),
    db.prepare('DELETE FROM delivery_notes WHERE delivery_note_id = ?').bind(deliveryNoteId),
  ]);
}
