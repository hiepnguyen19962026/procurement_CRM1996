import {
  getTechnicalClarificationSQL,
  insertTechnicalClarificationSQL,
  listTechnicalClarificationsSQL,
  nextClarificationSequenceSQL,
  softDeleteTechnicalClarificationSQL,
  updateRfqItemTechnicalFinalSQL,
  updateTechnicalClarificationSQL,
} from '../db/technical-clarification-queries.js';
import { getRfqItemSQL } from '../db/rfq-item-queries.js';
import { ALL_ROLES, MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { invalidateKv } from '../lib/cache.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanString } from '../lib/normalize.js';
import { json, makeId, nowIso, readJson } from '../lib/utils.js';

const CLARIFICATION_TYPES = new Set([
  'ask_supplier',
  'supplier_reply',
  'ask_client',
  'client_reply',
  'replacement_proposal',
  'final_confirm',
]);

const STATUS_AFTER = new Set([
  'waiting_supplier',
  'waiting_client',
  'need_more_info',
  'final_confirmed',
  'rejected',
]);

const TECH_STATUS_MAP = {
  waiting_supplier: 'dang_hoi',
  waiting_client: 'dang_hoi',
  need_more_info: 'can_bo_sung',
  final_confirmed: 'da_xac_nhan',
  rejected: 'bi_tu_choi',
};

export async function handleTechnicalClarifications(action, request, env, ctx, actor) {
  if (action === 'getTechnicalClarifications') return listClarifications(request, env, actor);
  if (action === 'createTechnicalClarification') return saveClarification(request, env, ctx, actor, false);
  if (action === 'updateTechnicalClarification') return saveClarification(request, env, ctx, actor, true);
  if (action === 'deleteTechnicalClarification') return deleteClarification(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown technical clarification action' }, 400);
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

async function saveClarification(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, isUpdate ? MANAGE_ROLES : WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();
  const clarificationId = cleanString(body.clarificationId || body.clarification_id, 80);
  const oldRow = isUpdate ? await getTechnicalClarificationSQL(env.DB, clarificationId) : null;
  if (isUpdate && (!oldRow || oldRow.deleted_at)) return json({ ok: false, error: 'Khong tim thay trao doi ky thuat' }, 404);

  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id || oldRow?.rfq_item_id, 80);
  const item = await getRfqItemSQL(env.DB, rfqItemId);
  if (!item) return json({ ok: false, error: 'Khong tim thay dong vat tu' }, 404);

  let row;
  try {
    row = normalizeClarification(body, {
      clarification_id: isUpdate ? oldRow.clarification_id : makeId('TCL'),
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

  if (isUpdate) await updateTechnicalClarificationSQL(env.DB, row);
  else await insertTechnicalClarificationSQL(env.DB, row);

  if (shouldUpdateFinal(row, body)) {
    await updateRfqItemTechnicalFinalSQL(env.DB, {
      rfq_item_id: row.rfq_item_id,
      final_model: row.proposed_model,
      final_manufacturer: row.proposed_manufacturer,
      final_origin: row.proposed_origin,
      trang_thai_ky_thuat: mappedTechnicalStatus(row),
      updated_at: now,
    });
  }

  ctx.waitUntil(invalidateKv(env, ['dashboard:v1']));
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? 'updateTechnicalClarification' : 'createTechnicalClarification',
    entityType: 'technical_clarification',
    entityId: row.clarification_id,
    oldJson: oldRow,
    newJson: row,
    actor,
  }));
  return json({ ok: true, clarification: row });
}

async function deleteClarification(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const clarificationId = cleanString(body.clarificationId || body.clarification_id, 80);
  const oldRow = await getTechnicalClarificationSQL(env.DB, clarificationId);
  if (!oldRow || oldRow.deleted_at) return json({ ok: false, error: 'Khong tim thay trao doi ky thuat' }, 404);
  const now = nowIso();
  await softDeleteTechnicalClarificationSQL(env.DB, { clarificationId, deletedAt: now });
  ctx.waitUntil(writeActionLog(env, {
    action: 'deleteTechnicalClarification',
    entityType: 'technical_clarification',
    entityId: clarificationId,
    oldJson: oldRow,
    newJson: { ...oldRow, deleted_at: now },
    actor,
  }));
  return json({ ok: true });
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
  };
}

function shouldUpdateFinal(row, body) {
  const checked = body.updateFinal === true || body.updateFinal === 'on' || body.updateFinal === 'true';
  return checked && (row.clarification_type === 'final_confirm' || row.status_after === 'final_confirmed');
}

function mappedTechnicalStatus(row) {
  const status = row.clarification_type === 'final_confirm' ? 'final_confirmed' : row.status_after;
  return TECH_STATUS_MAP[status] || 'da_xac_nhan';
}
