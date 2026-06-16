import {
  getTechnicalClarificationSQL,
  insertTechnicalClarificationSQL,
  listAllClarificationsSQL,
  listTechnicalClarificationsSQL,
  nextClarificationId,
  nextClarificationSequenceSQL,
  quickUpdateClarificationSQL,
  softDeleteTechnicalClarificationSQL,
  updateTechnicalClarificationSQL,
} from '../db/technical-clarification-queries.js';
import { getRfqItemSQL } from '../db/rfq-item-queries.js';
import { listRfqItemRevisionsSQL, insertRevisionStmt, snapshotFromItem } from '../db/rfq-item-revision-queries.js';
import { ALL_ROLES, MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { invalidateKv } from '../lib/cache.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanString } from '../lib/normalize.js';
import { json, makeId, nowIso, readJson } from '../lib/utils.js';

const CLARIFICATION_TYPES = new Set([
  'ask_supplier',       // Hỏi hãng
  'supplier_opinion',   // HSX ý kiến
  'supplier_reply',     // HSX phản hồi
  'ask_client',         // CĐT ý kiến
  'client_reply',       // CĐT phản hồi
  'replacement_proposal',
  'final_confirm',      // Final confirm — triggers revision when confirmRevision=true
  'rejected',           // Từ chối
  'other',              // Khác
]);

const STATUS_AFTER = new Set([
  'processing',         // Đang xử lý
  'waiting_supplier',   // Đang hỏi hãng
  'waiting_client',     // Đang chờ CĐT
  'need_more_info',     // Cần bổ sung
  'final_confirmed',    // Đã xác nhận — triggers revision when confirmRevision=true
  'rejected',           // Bị từ chối
  'other',              // Khác
]);

const TECH_STATUS_MAP = {
  waiting_supplier: 'dang_hoi',
  waiting_client: 'dang_hoi',
  need_more_info: 'can_bo_sung',
  final_confirmed: 'da_xac_nhan',
  rejected: 'bi_tu_choi',
};

export async function handleTechnicalClarifications(action, request, env, ctx, actor) {
  if (action === 'listAllClarifications')        return listAllClarifications(request, env, actor);
  if (action === 'getTechnicalClarifications')  return listClarifications(request, env, actor);
  if (action === 'getItemRevisions')            return listRevisions(request, env, actor);
  if (action === 'createTechnicalClarification') return saveClarification(request, env, ctx, actor, false);
  if (action === 'updateTechnicalClarification') return saveClarification(request, env, ctx, actor, true);
  if (action === 'deleteTechnicalClarification') return deleteClarification(request, env, ctx, actor);
  if (action === 'quickUpdateClarification')    return quickUpdateClar(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown technical clarification action' }, 400);
}

async function listAllClarifications(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body    = await readJson(request);
  const q       = cleanString(body.q,   200) || '';
  const q2      = cleanString(body.q2,  200) || '';
  const q3      = cleanString(body.q3,  200) || '';
  const sortBy  = cleanString(body.sortBy  || body.sort_by,  40) || 'created_at';
  const sortDir = body.sortDir === 'asc' || body.sort_dir === 'asc' ? 'asc' : 'desc';
  const cursor  = cleanString(body.cursor, 300) || '';
  const limit   = Math.min(Number(body.limit) || 50, 100);
  const result  = await listAllClarificationsSQL(env.DB, { q, q2, q3, sortBy, sortDir, cursor, limit });
  return json({ ok: true, ...result });
}

async function listClarifications(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id, 80);
  if (!rfqItemId) return json({ ok: false, error: 'Thieu ma dong vat tu' }, 400);
  const rows = await listTechnicalClarificationsSQL(env.DB, rfqItemId);
  return json({ ok: true, rows });
}

async function listRevisions(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id, 80);
  if (!rfqItemId) return json({ ok: false, error: 'Thieu ma dong vat tu' }, 400);
  const rows = await listRfqItemRevisionsSQL(env.DB, rfqItemId);
  return json({ ok: true, rows });
}

async function saveClarification(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, isUpdate ? MANAGE_ROLES : WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();
  const clarificationId = cleanString(body.clarificationId || body.clarification_id, 80);
  const oldRow = isUpdate ? await getTechnicalClarificationSQL(env.DB, clarificationId) : null;
  if (isUpdate && (!oldRow || oldRow.deleted_at)) return json({ ok: false, error: 'Khong tim thay trao doi ky thuat' }, 404);

  // Business fields are locked once a revision exists — spec history must not be rewritten.
  // Exception: external_url and attachment_file_id (URL/file evidence) may still be updated.
  if (isUpdate) {
    const linked = await env.DB.prepare(
      `SELECT 1 FROM rfq_item_revisions WHERE source_clarification_id = ? LIMIT 1`
    ).bind(clarificationId).first();
    if (linked) {
      if (!isEvidenceOnlyUpdate(body, oldRow)) {
        return json({ ok: false, error: 'Trao doi nay da tao lich su thay doi quy cach va khong the chinh sua' }, 409);
      }
      // Narrow evidence-only path: update URL/file only, no revision side-effects.
      const evUrl    = cleanUrl(body.externalUrl || body.external_url);
      const evFileId = cleanString(body.attachmentFileId || body.attachment_file_id, 120) || null;
      const evNow    = nowIso();
      await env.DB.prepare(
        `UPDATE technical_clarifications SET external_url = ?, attachment_file_id = ?, updated_at = ? WHERE clarification_id = ? AND deleted_at IS NULL`
      ).bind(evUrl || null, evFileId, evNow, clarificationId).run();
      ctx.waitUntil(writeActionLog(env, {
        action:     'updateTechnicalClarificationEvidence',
        entityType: 'technical_clarification',
        entityId:   clarificationId,
        message:    `Cập nhật URL/bằng chứng trao đổi kỹ thuật — ${clarificationId}`,
        oldJson:    { external_url: oldRow.external_url, attachment_file_id: oldRow.attachment_file_id },
        newJson:    { external_url: evUrl || null, attachment_file_id: evFileId },
        actor,
      }));
      return json({ ok: true, clarification: { ...oldRow, external_url: evUrl || null, attachment_file_id: evFileId, updated_at: evNow } });
    }
  }

  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id || oldRow?.rfq_item_id, 80);
  const item = await getRfqItemSQL(env.DB, rfqItemId);
  if (!item) return json({ ok: false, error: 'Khong tim thay dong vat tu' }, 404);

  let row;
  try {
    row = normalizeClarification(body, {
      clarification_id: isUpdate ? oldRow.clarification_id : await nextClarificationId(env.DB),
      rfq_item_id: rfqItemId,
      sequence_no: isUpdate ? oldRow.sequence_no : await nextClarificationSequenceSQL(env.DB, rfqItemId),
      created_by: isUpdate ? oldRow.created_by : actor.id,
      created_at: isUpdate ? oldRow.created_at : now,
      updated_at: isUpdate ? now : null,
      deleted_at: null,
    });
  } catch (err) {
    return json({ ok: false, error: err.message || 'Du lieu trao doi ky thuat khong hop le' }, 400);
  }

  // Write clarification row first.
  if (isUpdate) await updateTechnicalClarificationSQL(env.DB, row);
  else await insertTechnicalClarificationSQL(env.DB, row);

  // confirmRevision=true → user explicitly confirmed creating a spec revision snapshot.
  const confirmRevision = body.confirmRevision === true || body.confirmRevision === 'true';
  if (shouldCreateRevision(row, confirmRevision)) {
    await applyRevisionBatch(env.DB, { item, clarificationRow: row, now, actorId: actor.id });
  }

  ctx.waitUntil(invalidateKv(env, ['dashboard:v1']));
  ctx.waitUntil(writeActionLog(env, {
    action:     isUpdate ? 'updateTechnicalClarification' : 'createTechnicalClarification',
    entityType: 'technical_clarification',
    entityId:   row.clarification_id,
    message:    isUpdate
      ? `Cập nhật trao đổi kỹ thuật [${row.clarification_type}] — vật tư ${rfqItemId}`
      : `Trao đổi kỹ thuật mới [${row.clarification_type}] — vật tư ${rfqItemId}`,
    oldJson:    oldRow,
    newJson:    row,
    actor,
  }));
  return json({ ok: true, clarification: row });
}

async function quickUpdateClar(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const clarId = cleanString(body.clarificationId || body.clarification_id, 80);
  if (!clarId) return json({ ok: false, error: 'Thiếu clarification_id' }, 400);
  const newType   = cleanString(body.clarificationType || body.clarification_type, 50) || null;
  const newStatus = cleanString(body.statusAfter || body.status_after, 50) || null;
  if (newType   && !CLARIFICATION_TYPES.has(newType))   return json({ ok: false, error: 'Loại làm rõ không hợp lệ' }, 400);
  if (newStatus && !STATUS_AFTER.has(newStatus))         return json({ ok: false, error: 'Trạng thái không hợp lệ' }, 400);
  const existing = await getTechnicalClarificationSQL(env.DB, clarId);
  if (!existing || existing.deleted_at) return json({ ok: false, error: 'Không tìm thấy trao đổi kỹ thuật' }, 404);
  const finalType   = newType   || existing.clarification_type;
  const finalStatus = newStatus || existing.status_after;
  const now = nowIso();
  await quickUpdateClarificationSQL(env.DB, clarId, finalType, finalStatus, now);
  await invalidateKv(env, ['dashboard:v2']);
  ctx.waitUntil(writeActionLog(env, {
    action:     'quickUpdateClarification',
    entityType: 'technical_clarification',
    entityId:   clarId,
    message:    `Cập nhật nhanh trao đổi [${finalType}/${finalStatus}] — ${clarId}`,
    oldJson:    { clarification_type: existing.clarification_type, status_after: existing.status_after },
    newJson:    { clarification_type: finalType, status_after: finalStatus },
    actor,
  }));
  return json({ ok: true });
}

async function deleteClarification(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const clarificationId = cleanString(body.clarificationId || body.clarification_id, 80);
  const oldRow = await getTechnicalClarificationSQL(env.DB, clarificationId);
  if (!oldRow || oldRow.deleted_at) return json({ ok: false, error: 'Khong tim thay trao doi ky thuat' }, 404);
  const linkedRev = await env.DB.prepare(
    `SELECT 1 FROM rfq_item_revisions WHERE source_clarification_id = ? LIMIT 1`
  ).bind(clarificationId).first();
  if (linkedRev) return json({ ok: false, error: 'Trao doi nay da tao lich su thay doi quy cach va khong the xoa' }, 409);
  const now = nowIso();
  await softDeleteTechnicalClarificationSQL(env.DB, { clarificationId, deletedAt: now });
  ctx.waitUntil(writeActionLog(env, {
    action:     'deleteTechnicalClarification',
    entityType: 'technical_clarification',
    entityId:   clarificationId,
    message:    `Xóa trao đổi kỹ thuật [${oldRow.clarification_type}] — vật tư ${oldRow.rfq_item_id}`,
    oldJson:    oldRow,
    newJson:    { ...oldRow, deleted_at: now },
    actor,
  }));
  return json({ ok: true });
}

// shouldCreateRevision — requires explicit user confirmation (confirmRevision=true) and a
// final-type clarification.  Without confirmation the clarification is saved as a discussion
// record only; no spec fields on rfq_items are changed.
function shouldCreateRevision(row, confirmRevision) {
  return confirmRevision === true
    && (row.clarification_type === 'final_confirm' || row.status_after === 'final_confirmed');
}

// applyRevisionBatch — atomically:
//   1. If this is the first revision, insert revision_no=0 (original snapshot before change).
//   2. Update rfq_items with new final spec fields + increment current_revision_no.
//   3. Insert revision_no=N (snapshot after change).
// Uses D1 batch for atomicity.
async function applyRevisionBatch(db, { item, clarificationRow, now, actorId }) {
  const currentRevNo = Number(item.current_revision_no || 0);
  const newRevNo = currentRevNo + 1;

  // Effective final values: proposed fields win over existing final fields when non-empty.
  const finalModel = clarificationRow.proposed_model || item.quy_cach_final || null;
  const finalManufacturer = clarificationRow.proposed_manufacturer || item.hang_final || null;
  const finalOrigin = clarificationRow.proposed_origin || item.xuat_xu_final || null;
  const finalStatus = mappedTechnicalStatus(clarificationRow);

  const stmts = [];

  // Revision 0 = snapshot of item BEFORE this change (created lazily on first revision).
  if (currentRevNo === 0) {
    stmts.push(insertRevisionStmt(db, {
      revision_id: makeId('RIR'),
      rfq_item_id: item.rfq_item_id,
      revision_no: 0,
      source_clarification_id: null,
      ...snapshotFromItem(item),
      created_at: now,
      created_by: actorId,
    }));
  }

  // Apply final spec update to rfq_items and increment revision counter.
  stmts.push(db.prepare(
    `UPDATE rfq_items
     SET quy_cach_final = ?, hang_final = ?, xuat_xu_final = ?,
         trang_thai_ky_thuat = ?, current_revision_no = ?, updated_at = ?
     WHERE rfq_item_id = ?`
  ).bind(finalModel, finalManufacturer, finalOrigin, finalStatus, newRevNo, now, item.rfq_item_id));

  // Revision N = snapshot AFTER the change.
  stmts.push(insertRevisionStmt(db, {
    revision_id: makeId('RIR'),
    rfq_item_id: item.rfq_item_id,
    revision_no: newRevNo,
    source_clarification_id: clarificationRow.clarification_id,
    ...snapshotFromItem(item),
    // override with the new final values
    quy_cach_final: finalModel,
    hang_final: finalManufacturer,
    xuat_xu_final: finalOrigin,
    trang_thai_ky_thuat: finalStatus,
    created_at: now,
    created_by: actorId,
  }));

  await db.batch(stmts);
}

function cleanUrl(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  return s.slice(0, 2000);
}

function normalizeClarification(body, base) {
  const clarificationType = cleanString(body.clarificationType || body.clarification_type, 40);
  const statusAfter = cleanString(body.statusAfter || body.status_after, 40);
  const title = cleanString(body.title, 240);
  if (!CLARIFICATION_TYPES.has(clarificationType)) throw new Error('Loai trao doi ky thuat khong hop le');
  if (statusAfter && !STATUS_AFTER.has(statusAfter)) throw new Error('Trang thai sau trao doi khong hop le');
  if (!title) throw new Error('Tieu de trao doi la bat buoc');
  return {
    ...base,
    clarification_type: clarificationType,
    title,
    content: cleanString(body.content, 3000),
    old_model: cleanString(body.oldModel || body.old_model, 1000),
    proposed_model: cleanString(body.proposedModel || body.proposed_model, 1000),
    proposed_manufacturer: cleanString(body.proposedManufacturer || body.proposed_manufacturer, 180),
    proposed_origin: cleanString(body.proposedOrigin || body.proposed_origin, 120),
    status_after: statusAfter,
    attachment_file_id: cleanString(body.attachmentFileId || body.attachment_file_id, 120),
    raw_note: cleanString(body.rawNote || body.raw_note, 2000),
    external_url: cleanUrl(body.externalUrl || body.external_url),
  };
}

function mappedTechnicalStatus(row) {
  const status = row.clarification_type === 'final_confirm' ? 'final_confirmed' : row.status_after;
  return TECH_STATUS_MAP[status] || 'da_xac_nhan';
}

// isEvidenceOnlyUpdate — returns true when body changes only external_url / attachment_file_id.
// Compares every business field from body against oldRow using the same cleanString limits as
// normalizeClarification. Any mismatch means a business field was changed → must stay locked.
function isEvidenceOnlyUpdate(body, oldRow) {
  if (body.confirmRevision === true || body.confirmRevision === 'true') return false;
  const c = (s, max) => cleanString(s ?? '', max);
  const checks = [
    [c(body.clarificationType || body.clarification_type, 40),        c(oldRow.clarification_type, 40)],
    [c(body.title, 240),                                               c(oldRow.title, 240)],
    [c(body.content, 3000),                                            c(oldRow.content, 3000)],
    [c(body.oldModel || body.old_model, 1000),                        c(oldRow.old_model, 1000)],
    [c(body.proposedModel || body.proposed_model, 1000),              c(oldRow.proposed_model, 1000)],
    [c(body.proposedManufacturer || body.proposed_manufacturer, 180), c(oldRow.proposed_manufacturer, 180)],
    [c(body.proposedOrigin || body.proposed_origin, 120),             c(oldRow.proposed_origin, 120)],
    [c(body.statusAfter || body.status_after, 40),                    c(oldRow.status_after, 40)],
    [c(body.rawNote || body.raw_note, 2000),                          c(oldRow.raw_note, 2000)],
  ];
  for (const [fromBody, fromRow] of checks) {
    if (fromBody !== fromRow) return false;
  }
  return true;
}
