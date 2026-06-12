import { archiveRfqSQL, getDashboardSQL, getRfqSQL, insertRfqSQL, listRfqsSQL, updateRfqSQL } from '../db/rfq-queries.js';
import { ALL_ROLES, MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { getKv, setKv, invalidateKv } from '../lib/cache.js';
import { writeActionLog } from '../lib/action-log.js';
import { buildSearchText, cleanMoney, cleanString, normalizeText } from '../lib/normalize.js';
import { clampLimit, json, nextEntityId, nowIso, readJson } from '../lib/utils.js';

export async function handleRfqs(action, request, env, ctx, actor) {
  if (action === 'getDashboard') return getDashboard(env, actor);
  if (action === 'getRfqs') return listRfqs(request, env, actor);
  if (action === 'getRfq') return getOneRfq(request, env, actor);
  if (action === 'createRfq') return saveRfq(request, env, ctx, actor, false);
  if (action === 'updateRfq') return saveRfq(request, env, ctx, actor, true);
  if (action === 'archiveRfq') return archiveRfq(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown RFQ action' }, 400);
}

async function getOneRfq(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const rfqId = p.rfqId || p.rfq_id || '';
  if (!rfqId) return json({ ok: false, error: 'Missing rfqId' }, 400);
  const row = await getRfqSQL(env.DB, rfqId);
  if (!row) return json({ ok: false, error: 'RFQ not found' }, 404);
  return json({ ok: true, row });
}

async function getDashboard(env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const cached = await getKv(env, 'dashboard:v1');
  if (cached) return json({ ok: true, summary: cached });
  const summary = await getDashboardSQL(env.DB);
  await setKv(env, 'dashboard:v1', summary, 300);
  return json({ ok: true, summary });
}

async function listRfqs(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const data = await listRfqsSQL(env.DB, { q: normalizeText(p.q), status: p.status || '', cursor: p.cursor || '', sortBy: p.sortBy || '', sortDir: p.sortDir || '', limit: clampLimit(p.limit) });
  return json({ ok: true, ...data });
}

async function archiveRfq(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 80);
  if (!rfqId) return json({ ok: false, error: 'Thieu ma RFQ' }, 400);
  const row = await getRfqSQL(env.DB, rfqId);
  if (!row) return json({ ok: false, error: 'Khong tim thay RFQ' }, 404);
  const now = nowIso();
  await archiveRfqSQL(env.DB, rfqId, now);
  ctx.waitUntil(invalidateKv(env, ['dashboard:v1']));
  ctx.waitUntil(writeActionLog(env, { action: 'archiveRfq', entityType: 'rfq', entityId: rfqId, message: `Lưu trữ gói thầu: "${row.ten_goi}" (${rfqId})`, oldJson: row, newJson: null, actor }));
  return json({ ok: true });
}

async function saveRfq(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const title = cleanString(body.tenGoi || body.ten_goi, 240);
  if (!title) return json({ ok: false, error: 'Ten goi RFQ la bat buoc' }, 400);
  const now = nowIso();
  const oldRow = isUpdate ? await getRfqSQL(env.DB, body.rfqId || body.rfq_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: 'Khong tim thay RFQ' }, 404);
  const row = {
    rfq_id: isUpdate ? oldRow.rfq_id : await nextEntityId(env.DB, 'rfqs', 'rfq_id', 'RFQ'),
    client_id: cleanString(body.clientId || body.client_id, 80),
    ma_goi_tbmt: cleanString(body.maGoiTbmt || body.ma_goi_tbmt, 120),
    ten_goi: title,
    nha_may_cdt: cleanString(body.nhaMayCdt || body.nha_may_cdt, 180),
    ngay_nhan_hoac_dang_tai: cleanString(body.ngayNhanHoacDangTai || body.ngay_nhan_hoac_dang_tai, 20),
    ngay_het_han: cleanString(body.ngayHetHan || body.ngay_het_han, 20),
    du_toan: cleanMoney(body.duToan ?? body.du_toan),
    trang_thai_goi: cleanString(body.trangThaiGoi || body.trang_thai_goi || 'dang_khao_gia', 40),
    source_file_id: cleanString(body.sourceFileId || body.source_file_id, 120),
    note: cleanString(body.note, 1500),
    normalized_search: buildSearchText([title, body.maGoiTbmt, body.ma_goi_tbmt, body.nhaMayCdt, body.nha_may_cdt]),
    created_by: oldRow?.created_by || actor.id,
    created_at: oldRow?.created_at || now,
    updated_at: now,
  };
  if (isUpdate) await updateRfqSQL(env.DB, row);
  else await insertRfqSQL(env.DB, row);
  ctx.waitUntil(invalidateKv(env, ['dashboard:v1']));
  ctx.waitUntil(writeActionLog(env, { action: isUpdate ? 'updateRfq' : 'createRfq', entityType: 'rfq', entityId: row.rfq_id, message: isUpdate ? `Cập nhật gói thầu: "${row.ten_goi}" (${row.rfq_id})` : `Tạo gói thầu mới: "${row.ten_goi}" (${row.rfq_id})`, oldJson: oldRow, newJson: row, actor }));
  return json({ ok: true, rfq: row });
}
