export async function listRfqItemRevisionsSQL(db, rfqItemId) {
  const res = await db.prepare(
    `SELECT r.*,
       tc.title AS clarification_title,
       u.display_name AS created_by_name
     FROM rfq_item_revisions r
     LEFT JOIN technical_clarifications tc ON tc.clarification_id = r.source_clarification_id
     LEFT JOIN users u ON u.user_id = r.created_by
     WHERE r.rfq_item_id = ?
     ORDER BY r.revision_no ASC`
  ).bind(rfqItemId).all();
  return res.results || [];
}

// Returns a prepared D1 statement (not yet executed) for use in db.batch([...]).
export function insertRevisionStmt(db, rev) {
  return db.prepare(
    `INSERT INTO rfq_item_revisions (
      revision_id, rfq_item_id, revision_no, source_clarification_id,
      ma_mua_sam, ma_vat_tu, ten_vat_tu,
      required_model, manufacturer, brand, origin_country, technical_params, note,
      quy_cach_final, hang_final, xuat_xu_final, trang_thai_ky_thuat,
      created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    rev.revision_id, rev.rfq_item_id, rev.revision_no, rev.source_clarification_id ?? null,
    rev.ma_mua_sam ?? null, rev.ma_vat_tu ?? null, rev.ten_vat_tu ?? null,
    rev.required_model ?? null, rev.manufacturer ?? null, rev.brand ?? null,
    rev.origin_country ?? null, rev.technical_params ?? null, rev.note ?? null,
    rev.quy_cach_final ?? null, rev.hang_final ?? null, rev.xuat_xu_final ?? null,
    rev.trang_thai_ky_thuat ?? null,
    rev.created_at, rev.created_by ?? null
  );
}

// Extract snapshot-worthy fields from a live rfq_items row.
export function snapshotFromItem(item) {
  return {
    ma_mua_sam:          item.ma_mua_sam          ?? null,
    ma_vat_tu:           item.ma_vat_tu            ?? null,
    ten_vat_tu:          item.ten_vat_tu           ?? null,
    required_model:      item.required_model       ?? null,
    manufacturer:        item.manufacturer         ?? null,
    brand:               item.brand                ?? null,
    origin_country:      item.origin_country       ?? null,
    technical_params:    item.technical_params     ?? null,
    note:                item.note                 ?? null,
    quy_cach_final:      item.quy_cach_final       ?? null,
    hang_final:          item.hang_final           ?? null,
    xuat_xu_final:       item.xuat_xu_final        ?? null,
    trang_thai_ky_thuat: item.trang_thai_ky_thuat  ?? null,
  };
}
