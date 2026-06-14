import {
  archiveDeliveryNoteItemSQL,
  archiveDeliveryNoteSQL,
  deleteDeliveryNoteSQL,
  getDeliveryItemsForRfqItemSQL,
  getDeliveryNoteItemSQL,
  getDeliveryNoteItemsSQL,
  getDeliveryNoteItemStatusesSQL,
  getDeliveryNoteSQL,
  insertDeliveryNoteItemSQL,
  insertDeliveryNoteSQL,
  listDeliveryNotesSQL,
  nextDeliveryNoteNoSQL,
  recordAcceptanceSQL,
  updateDeliveryNoteItemSQL,
  updateDeliveryNoteSQL,
} from '../db/delivery-queries.js';
import { getContractItemSQL, getContractSQL } from '../db/contract-queries.js';
import { getRfqItemSQL } from '../db/rfq-item-queries.js';
import { getRfqSQL } from '../db/rfq-queries.js';
import { ALL_ROLES, MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { invalidateKv } from '../lib/cache.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanNumber, cleanString } from '../lib/normalize.js';
import { clampLimit, json, makeId, nowIso, readJson } from '../lib/utils.js';

const VALID_STATUS    = new Set(['active', 'archived']);
const VALID_NOTE_TYPES = new Set(['delivery', 'return']);
const VALID_ACCEPTANCE_STATUSES      = new Set(['pending', 'accepted', 'partial', 'rejected']);
const VALID_ACCEPTANCE_ITEM_STATUSES = new Set(['pending', 'accepted', 'rejected']);
const VALID_PAYMENT_STATUSES         = new Set(['not_ready', 'ready', 'requested', 'paid']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DASHBOARD_KEYS = ['dashboard:v1', 'dashboard:v2'];

export async function handleDelivery(action, request, env, ctx, actor) {
  if (action === 'getDeliveryNotes')           return listNotes(request, env, actor);
  if (action === 'getDeliveryNoteDetail')      return getNoteDetail(request, env, actor);
  if (action === 'getDeliveryItemsForRfqItem') return getItemsForRfqItem(request, env, actor);
  if (action === 'createDeliveryNote')         return saveNote(request, env, ctx, actor, false);
  if (action === 'updateDeliveryNote')         return saveNote(request, env, ctx, actor, true);
  if (action === 'archiveDeliveryNote')        return archiveNote(request, env, ctx, actor);
  if (action === 'addDeliveryNoteItem')        return saveItem(request, env, ctx, actor, false);
  if (action === 'updateDeliveryNoteItem')     return saveItem(request, env, ctx, actor, true);
  if (action === 'archiveDeliveryNoteItem')    return archiveItem(request, env, ctx, actor);
  if (action === 'recordDeliveryAcceptance')   return recordAcceptance(request, env, ctx, actor);
  if (action === 'deleteDeliveryNote')         return deleteNote(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown delivery action' }, 400);
}

async function listNotes(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const limit = clampLimit(body.limit, 50, 200);
  const cursorRaw = cleanString(body.cursor || '', 200);
  let cursorDate = '';
  let cursorId = '';
  if (cursorRaw) {
    const parts = cursorRaw.split('|');
    if (parts.length === 2) {
      cursorDate = parts[0];
      cursorId = parts[1];
    }
  }

  const status   = cleanString(body.status   || '', 20);
  const noteType = cleanString(body.noteType || body.note_type || '', 20);
  const rows = await listDeliveryNotesSQL(env.DB, {
    q: cleanString(body.q || '', 200),
    rfqId:      cleanString(body.rfqId      || body.rfq_id      || '', 80),
    contractId: cleanString(body.contractId || body.contract_id || '', 80),
    clientId:   cleanString(body.clientId   || body.client_id   || '', 80),
    noteType:   VALID_NOTE_TYPES.has(noteType) ? noteType : '',
    status:     VALID_STATUS.has(status) ? status : '',
    dateFrom: validateDate(body.dateFrom || body.date_from || ''),
    dateTo: validateDate(body.dateTo || body.date_to || ''),
    cursorDate,
    cursorId,
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.delivery_date}|${last.delivery_note_id}` : null;
  return json({ ok: true, rows: page, hasMore, nextCursor });
}

async function getNoteDetail(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const deliveryNoteId = cleanString(body.deliveryNoteId || body.delivery_note_id || '', 80);
  if (!deliveryNoteId) return json({ ok: false, error: 'Thieu ma phieu giao hang' }, 400);
  const note = await getDeliveryNoteSQL(env.DB, deliveryNoteId);
  if (!note) return json({ ok: false, error: 'Khong tim thay phieu giao hang' }, 404);
  const items = await getDeliveryNoteItemsSQL(env.DB, deliveryNoteId);
  return json({ ok: true, note, items });
}

async function getItemsForRfqItem(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id || '', 80);
  if (!rfqItemId) return json({ ok: false, error: 'Thieu rfqItemId' }, 400);
  const rows = await getDeliveryItemsForRfqItemSQL(env.DB, rfqItemId);
  return json({ ok: true, rows });
}

async function saveNote(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();

  const deliveryNoteId = cleanString(body.deliveryNoteId || body.delivery_note_id || '', 80);
  const oldNote = isUpdate ? await getDeliveryNoteSQL(env.DB, deliveryNoteId) : null;
  if (isUpdate && !oldNote) return json({ ok: false, error: 'Khong tim thay phieu giao hang' }, 404);
  if (isUpdate && oldNote.status === 'archived') return json({ ok: false, error: 'Phieu da luu tru, khong sua duoc' }, 400);

  const deliveryDate = validateDate(body.deliveryDate || body.delivery_date || oldNote?.delivery_date || '');
  if (!deliveryDate) return json({ ok: false, error: 'Ngay giao hang khong hop le' }, 400);

  const rawNoteType = cleanString(body.noteType || body.note_type || oldNote?.note_type || '', 20);
  const noteType    = VALID_NOTE_TYPES.has(rawNoteType) ? rawNoteType : 'delivery';

  const rfqId      = cleanString(body.rfqId      || body.rfq_id      || oldNote?.rfq_id      || '', 80);
  const contractId = cleanString(body.contractId || body.contract_id || oldNote?.contract_id || '', 80);
  let clientId     = cleanString(body.clientId   || body.client_id   || oldNote?.client_id   || '', 80);

  if (rfqId) {
    const rfq = await getRfqSQL(env.DB, rfqId);
    if (!rfq) return json({ ok: false, error: 'RFQ khong ton tai' }, 400);
    if (!clientId) clientId = rfq.client_id || '';
  }
  if (contractId) {
    const contract = await getContractSQL(env.DB, contractId);
    if (!contract) return json({ ok: false, error: 'Hop dong khong ton tai' }, 400);
    if (!clientId) clientId = contract.client_id || '';
  }

  const manualNo = isUpdate ? null : cleanString(body.deliveryNoteNo || body.delivery_note_no || '', 80);
  const note = {
    delivery_note_id: isUpdate ? oldNote.delivery_note_id : makeId('DN'),
    delivery_note_no: isUpdate ? oldNote.delivery_note_no : (manualNo || await nextDeliveryNoteNoSQL(env.DB, deliveryDate, noteType)),
    note_type:    isUpdate ? oldNote.note_type : noteType,
    rfq_id:       rfqId      || null,
    contract_id:  contractId || null,
    client_id:    clientId   || null,
    delivery_date: deliveryDate,
    receiver_unit: cleanString(body.receiverUnit  || body.receiver_unit  || oldNote?.receiver_unit  || '', 200),
    sender_unit:   cleanString(body.senderUnit    || body.sender_unit    || oldNote?.sender_unit    || '', 200),
    receiver_name: cleanString(body.receiverName  || body.receiver_name  || oldNote?.receiver_name  || '', 120),
    sender_name:   cleanString(body.senderName    || body.sender_name    || oldNote?.sender_name    || '', 120),
    vehicle_no:    cleanString(body.vehicleNo     || body.vehicle_no     || oldNote?.vehicle_no     || '', 80),
    note:          cleanString(body.note          || oldNote?.note        || '', 2000),
    status:        isUpdate ? oldNote.status : 'active',
    created_by:    isUpdate ? oldNote.created_by : actor.id,
    created_at:    isUpdate ? oldNote.created_at : now,
    updated_at:    now,
    archived_at:   oldNote?.archived_at || null,
  };

  if (isUpdate) {
    await updateDeliveryNoteSQL(env.DB, note);
  } else {
    // Retry up to 3 times on UNIQUE conflict (concurrent same-day inserts).
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      if (attempt > 0) {
        note.delivery_note_no = await nextDeliveryNoteNoSQL(env.DB, deliveryDate, noteType);
      }
      try {
        await insertDeliveryNoteSQL(env.DB, note);
        inserted = true;
      } catch (e) {
        const msg = String(e?.message || '');
        if (attempt >= 2 || !msg.includes('UNIQUE')) throw e;
      }
    }
  }

  const createdItems = [];
  if (!isUpdate && Array.isArray(body.items)) {
    for (const raw of body.items.slice(0, 200)) {
      const item = await buildDeliveryItem(env.DB, { ...raw, deliveryNoteId: note.delivery_note_id }, now);
      if (!item) continue;
      await insertDeliveryNoteItemSQL(env.DB, item);
      createdItems.push(item);
    }
  }

  ctx.waitUntil(invalidateKv(env, DASHBOARD_KEYS));
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? 'updateDeliveryNote' : 'createDeliveryNote',
    entityType: 'delivery_note',
    entityId: note.delivery_note_id,
    message: isUpdate ? `Cap nhat phieu giao hang ${note.delivery_note_no}` : `Tao phieu giao hang ${note.delivery_note_no}`,
    oldJson: oldNote,
    newJson: createdItems.length ? { ...note, items: createdItems } : note,
    actor,
  }));
  return json({ ok: true, note, items: createdItems });
}

async function archiveNote(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const deliveryNoteId = cleanString(body.deliveryNoteId || body.delivery_note_id || '', 80);
  if (!deliveryNoteId) return json({ ok: false, error: 'Thieu ma phieu giao hang' }, 400);
  const old = await getDeliveryNoteSQL(env.DB, deliveryNoteId);
  if (!old) return json({ ok: false, error: 'Khong tim thay phieu giao hang' }, 404);
  if (old.status === 'archived') return json({ ok: false, error: 'Phieu da luu tru' }, 400);
  const now = nowIso();
  await archiveDeliveryNoteSQL(env.DB, deliveryNoteId, now);
  ctx.waitUntil(invalidateKv(env, DASHBOARD_KEYS));
  ctx.waitUntil(writeActionLog(env, {
    action: 'archiveDeliveryNote',
    entityType: 'delivery_note',
    entityId: deliveryNoteId,
    oldJson: old,
    newJson: { ...old, status: 'archived', archived_at: now, updated_at: now },
    actor,
  }));
  return json({ ok: true });
}

async function saveItem(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();

  const deliveryNoteItemId = cleanString(body.deliveryNoteItemId || body.delivery_note_item_id || '', 80);
  const oldItem = isUpdate ? await getDeliveryNoteItemSQL(env.DB, deliveryNoteItemId) : null;
  if (isUpdate && !oldItem) return json({ ok: false, error: 'Khong tim thay dong giao hang' }, 404);
  if (isUpdate && oldItem.status === 'archived') return json({ ok: false, error: 'Dong da luu tru, khong sua duoc' }, 400);

  const deliveryNoteId = cleanString(body.deliveryNoteId || body.delivery_note_id || oldItem?.delivery_note_id || '', 80);
  const deliveryNote = await getDeliveryNoteSQL(env.DB, deliveryNoteId);
  if (!deliveryNote) return json({ ok: false, error: 'Khong tim thay phieu giao hang' }, 404);
  if (deliveryNote.status === 'archived') return json({ ok: false, error: 'Phieu da luu tru, khong sua duoc' }, 400);

  const item = await buildDeliveryItem(env.DB, { ...body, deliveryNoteId, oldItem }, now, oldItem);
  if (!item) return json({ ok: false, error: 'Dong giao hang khong hop le' }, 400);

  if (isUpdate) await updateDeliveryNoteItemSQL(env.DB, item);
  else await insertDeliveryNoteItemSQL(env.DB, item);

  ctx.waitUntil(invalidateKv(env, DASHBOARD_KEYS));
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? 'updateDeliveryNoteItem' : 'addDeliveryNoteItem',
    entityType: 'delivery_note_item',
    entityId: item.delivery_note_item_id,
    oldJson: oldItem,
    newJson: item,
    actor,
  }));
  return json({ ok: true, item });
}

async function archiveItem(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const deliveryNoteItemId = cleanString(body.deliveryNoteItemId || body.delivery_note_item_id || '', 80);
  if (!deliveryNoteItemId) return json({ ok: false, error: 'Thieu ma dong giao hang' }, 400);
  const old = await getDeliveryNoteItemSQL(env.DB, deliveryNoteItemId);
  if (!old) return json({ ok: false, error: 'Khong tim thay dong giao hang' }, 404);
  if (old.status === 'archived') return json({ ok: false, error: 'Dong da luu tru' }, 400);
  const now = nowIso();
  await archiveDeliveryNoteItemSQL(env.DB, deliveryNoteItemId, now);
  ctx.waitUntil(invalidateKv(env, DASHBOARD_KEYS));
  ctx.waitUntil(writeActionLog(env, {
    action: 'archiveDeliveryNoteItem',
    entityType: 'delivery_note_item',
    entityId: deliveryNoteItemId,
    oldJson: old,
    newJson: { ...old, status: 'archived', archived_at: now, updated_at: now },
    actor,
  }));
  return json({ ok: true });
}

async function buildDeliveryItem(db, p, now, oldItem = null) {
  const deliveryNoteId = cleanString(p.deliveryNoteId || p.delivery_note_id || oldItem?.delivery_note_id || '', 80);
  let rfqItemId = cleanString(p.rfqItemId || p.rfq_item_id || oldItem?.rfq_item_id || '', 80);
  let contractItemId = cleanString(p.contractItemId || p.contract_item_id || oldItem?.contract_item_id || '', 80) || null;
  let itemId = cleanString(p.itemId || p.item_id || oldItem?.item_id || '', 80) || null;
  let lineNo = cleanString(p.lineNo || p.line_no || oldItem?.line_no || '', 40);
  let maVatTu = cleanString(p.maVatTu || p.ma_vat_tu || oldItem?.ma_vat_tu || '', 120);
  let tenVatTu = cleanString(p.tenVatTu || p.ten_vat_tu || oldItem?.ten_vat_tu || '', 500);
  let model = cleanString(p.requiredModel || p.required_model || oldItem?.required_model || '', 400);
  let manufacturer = cleanString(p.manufacturer || oldItem?.manufacturer || '', 180);
  let brand = cleanString(p.brand || oldItem?.brand || '', 120);
  let origin = cleanString(p.originCountry || p.origin_country || oldItem?.origin_country || '', 120);
  let unit = cleanString(p.unit || oldItem?.unit || '', 40);

  if (contractItemId) {
    const ci = await getContractItemSQL(db, contractItemId);
    if (ci) {
      if (!rfqItemId) rfqItemId = ci.rfq_item_id || '';
      if (!itemId) itemId = ci.item_id || null;
      if (!lineNo) lineNo = cleanString(ci.line_no || '', 40);
      if (!maVatTu) maVatTu = cleanString(ci.ma_vat_tu || '', 120);
      if (!tenVatTu) tenVatTu = cleanString(ci.ten_vat_tu || '', 500);
      if (!model) model = cleanString(ci.required_model || '', 400);
      if (!manufacturer) manufacturer = cleanString(ci.manufacturer || '', 180);
      if (!brand) brand = cleanString(ci.brand || '', 120);
      if (!origin) origin = cleanString(ci.origin_country || '', 120);
      if (!unit) unit = cleanString(ci.unit || '', 40);
    }
  }

  if (rfqItemId) {
    const ri = await getRfqItemSQL(db, rfqItemId);
    if (ri) {
      if (!itemId) itemId = ri.item_id || null;
      if (!maVatTu) maVatTu = cleanString(ri.ma_vat_tu || '', 120);
      if (!tenVatTu) tenVatTu = cleanString(ri.ten_vat_tu || '', 500);
      if (!model) model = cleanString(ri.required_model || ri.quy_cach_model_yeu_cau || '', 400);
      if (!manufacturer) manufacturer = cleanString(ri.manufacturer || ri.hang_goc_nsx_goc || '', 180);
      if (!brand) brand = cleanString(ri.brand || ri.nhan_hieu || '', 120);
      if (!origin) origin = cleanString(ri.origin_country || ri.xuat_xu || '', 120);
      if (!unit) unit = cleanString(ri.unit || ri.don_vi || '', 40);
    }
  }

  const qty = cleanNumber(p.deliveredQuantity ?? p.delivered_quantity ?? oldItem?.delivered_quantity ?? 0);
  if (!deliveryNoteId || !rfqItemId || !tenVatTu || qty < 0) return null;

  return {
    delivery_note_item_id: oldItem?.delivery_note_item_id || makeId('DNI'),
    delivery_note_id: deliveryNoteId,
    rfq_item_id: rfqItemId,
    contract_item_id: contractItemId,
    item_id: itemId,
    line_no: lineNo,
    ma_vat_tu: maVatTu || null,
    ten_vat_tu: tenVatTu,
    required_model: model || null,
    manufacturer: manufacturer || null,
    brand: brand || null,
    origin_country: origin || null,
    unit: unit || null,
    delivered_quantity: qty,
    note: cleanString(p.note || oldItem?.note || '', 2000),
    status: oldItem?.status || 'active',
    created_at: oldItem?.created_at || now,
    updated_at: now,
    archived_at: oldItem?.archived_at || null,
  };
}

async function deleteNote(request, env, ctx, actor) {
  // Admin only — enforced here in addition to gateway whitelist.
  if (!actor || actor.role !== 'admin') return json({ ok: false, error: 'Chi admin moi co the xoa phieu giao hang' }, 403);
  const body = await readJson(request);
  const deliveryNoteId = cleanString(body.deliveryNoteId || body.delivery_note_id || '', 80);
  if (!deliveryNoteId) return json({ ok: false, error: 'Thieu ma phieu giao hang' }, 400);

  const note = await getDeliveryNoteSQL(env.DB, deliveryNoteId);
  if (!note) return json({ ok: false, error: 'Khong tim thay phieu giao hang' }, 404);

  // Block if any acceptance or payment activity exists on the header.
  const hasActivity = (note.acceptance_status && note.acceptance_status !== 'pending')
    || (note.payment_request_status && note.payment_request_status !== 'not_ready');
  if (hasActivity) return json({ ok: false, error: 'Đơn giao hàng đã có nghiệm thu hoặc thanh toán, không thể xóa.' }, 400);

  // Also check individual items.
  const statuses = await getDeliveryNoteItemStatusesSQL(env.DB, deliveryNoteId);
  const itemHasActivity = statuses.some(r => r.acceptance_status && r.acceptance_status !== 'pending');
  if (itemHasActivity) return json({ ok: false, error: 'Đơn giao hàng đã có nghiệm thu hoặc thanh toán, không thể xóa.' }, 400);

  await deleteDeliveryNoteSQL(env.DB, deliveryNoteId);

  ctx.waitUntil(invalidateKv(env, DASHBOARD_KEYS));
  ctx.waitUntil(writeActionLog(env, {
    action: 'deleteDeliveryNote',
    entityType: 'delivery_note',
    entityId: deliveryNoteId,
    message: `Xoa vinh vien phieu giao hang ${note.delivery_note_no}`,
    oldJson: note,
    newJson: null,
    actor,
  }));
  return json({ ok: true });
}

function validateDate(value) {
  const s = cleanString(value || '', 20);
  return DATE_RE.test(s) ? s : '';
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function recordAcceptance(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now  = nowIso();

  const deliveryNoteId = cleanString(body.deliveryNoteId || body.delivery_note_id || '', 80);
  if (!deliveryNoteId) return json({ ok: false, error: 'Thieu ma phieu giao hang' }, 400);

  const note = await getDeliveryNoteSQL(env.DB, deliveryNoteId);
  if (!note) return json({ ok: false, error: 'Khong tim thay phieu giao hang' }, 404);
  if (note.status === 'archived') return json({ ok: false, error: 'Phieu da luu tru, khong sua duoc' }, 400);

  // Validate + normalize item rows
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return json({ ok: false, error: 'Khong co dong vat tu nao' }, 400);

  const itemRows = [];
  for (const raw of rawItems) {
    const id     = cleanString(raw.deliveryNoteItemId || raw.delivery_note_item_id || '', 80);
    if (!id) return json({ ok: false, error: 'Thieu delivery_note_item_id' }, 400);
    const rawStatus = cleanString(raw.acceptanceStatus || raw.acceptance_status || 'pending', 20);
    const itemStatus = VALID_ACCEPTANCE_ITEM_STATUSES.has(rawStatus) ? rawStatus : 'pending';
    const acceptedQty = Math.max(0, cleanNumber(raw.acceptedQuantity ?? raw.accepted_quantity ?? 0));
    const warrantyDays  = raw.warrantyDays != null ? Math.max(0, parseInt(raw.warrantyDays, 10) || 0) : null;
    const warrantyStart = validateDate(raw.warrantyStartDate || raw.warranty_start_date || '');
    let warrantyEnd     = validateDate(raw.warrantyEndDate   || raw.warranty_end_date   || '');
    if (warrantyDays && warrantyStart && !warrantyEnd) warrantyEnd = addDays(warrantyStart, warrantyDays);
    itemRows.push({
      delivery_note_item_id: id,
      accepted_quantity:     itemStatus === 'rejected' ? 0 : acceptedQty,
      acceptance_status:     itemStatus,
      rejection_reason:      cleanString(raw.rejectionReason || raw.rejection_reason || '', 500) || null,
      warranty_days:         warrantyDays || null,
      warranty_start_date:   warrantyStart || null,
      warranty_end_date:     warrantyEnd   || null,
    });
  }

  // Derive header status from ALL items in the note (not only submitted ones).
  // Fetch existing items, then merge: submitted rows override, unsubmitted rows keep current state.
  const existingStatuses = await getDeliveryNoteItemStatusesSQL(env.DB, deliveryNoteId);
  const submittedIds = new Set(itemRows.map(r => r.delivery_note_item_id));
  const mergedStatuses = [
    ...existingStatuses
      .filter(r => !submittedIds.has(r.delivery_note_item_id))
      .map(r => ({ status: r.acceptance_status || 'pending', qty: Number(r.accepted_quantity) || 0 })),
    ...itemRows.map(r => ({ status: r.acceptance_status, qty: Number(r.accepted_quantity) || 0 })),
  ];
  const allAccepted = mergedStatuses.every(r => r.status === 'accepted');
  const allRejected = mergedStatuses.every(r => r.status === 'rejected');
  const anyPending  = mergedStatuses.some(r => r.status === 'pending');
  let headerStatus = anyPending ? 'pending'
    : allAccepted ? 'accepted'
    : allRejected ? 'rejected'
    : 'partial';

  const acceptanceDate = validateDate(body.acceptanceDate || body.acceptance_date || '') || now.slice(0, 10);
  const totalAccepted  = mergedStatuses.reduce((s, r) => s + r.qty, 0);
  const paymentStatus  = (headerStatus === 'accepted' || headerStatus === 'partial') && totalAccepted > 0
    ? 'ready' : 'not_ready';

  const header = {
    acceptance_date:        acceptanceDate,
    acceptance_status:      headerStatus,
    acceptance_note:        cleanString(body.acceptanceNote || body.acceptance_note || '', 2000) || null,
    payment_request_status: paymentStatus,
    payment_request_date:   paymentStatus === 'ready' ? acceptanceDate : null,
  };

  await recordAcceptanceSQL(env.DB, deliveryNoteId, header, itemRows, now);

  ctx.waitUntil(invalidateKv(env, DASHBOARD_KEYS));
  ctx.waitUntil(writeActionLog(env, {
    action: 'recordDeliveryAcceptance',
    entityType: 'delivery_note',
    entityId: deliveryNoteId,
    message: `Ghi nghiem thu phieu ${note.delivery_note_no}: ${headerStatus}, ${totalAccepted} SL da NT`,
    oldJson: note,
    newJson: { ...header, deliveryNoteId, itemCount: itemRows.length },
    actor,
  }));
  return json({ ok: true, acceptanceStatus: headerStatus, paymentRequestStatus: paymentStatus });
}
