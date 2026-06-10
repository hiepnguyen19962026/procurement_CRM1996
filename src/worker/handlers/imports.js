import {
  findDuplicateRfqItemSQL,
  getImportJobSQL,
  getImportTemplateSQL,
  insertImportJobRowSQL,
  insertImportJobSQL,
  insertImportTemplateSQL,
  listImportJobRowsSQL,
  listImportTemplatesSQL,
  updateImportTemplateSQL,
} from '../db/import-queries.js';
import { getRfqSQL } from '../db/rfq-queries.js';
import { getRfqItemSQL, insertRfqItemSQL, updateRfqItemSQL } from '../db/rfq-item-queries.js';
import { ALL_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { invalidateKv } from '../lib/cache.js';
import { buildSearchText, cleanMoney, cleanNumber, cleanString } from '../lib/normalize.js';
import { clampLimit, json, makeId, nextEntityId, nowIso, readJson } from '../lib/utils.js';

const TARGET_FIELDS = new Set([
  'rfq_item_id',
  'ten_vat_tu',
  'stt_goc',
  'ma_vat_tu',
  'required_model',
  'manufacturer',
  'brand',
  'origin_country',
  'unit',
  'quantity',
  'yeu_cau_ky_thuat_bo_sung',
  'don_gia_sau_thue',
  'thanh_tien_sau_thue',
  'delivery_time',
  'origin_full_text',
]);

const TEXT_FIELDS = [
  'stt_goc',
  'ma_vat_tu',
  'ten_vat_tu',
  'required_model',
  'manufacturer',
  'brand',
  'origin_country',
  'unit',
  'yeu_cau_ky_thuat_bo_sung',
  'delivery_time',
  'origin_full_text',
];

export async function handleImports(action, request, env, ctx, actor) {
  if (action === 'getImportTemplates') return getTemplates(request, env, actor);
  if (action === 'saveImportTemplate') return saveTemplate(request, env, actor);
  if (action === 'commitImportRows') return commitRows(request, env, ctx, actor);
  if (action === 'getImportJob') return getJob(request, env, actor);
  if (action === 'getImportJobRows') return getJobRows(request, env, actor);
  return json({ ok: false, error: 'Unknown import action' }, 400);
}

async function getTemplates(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const ownerKey = cleanString(body.ownerKey || body.owner_key, 120);
  const rows = await listImportTemplatesSQL(env.DB, { ownerKey });
  return json({ ok: true, rows: rows.map(parseTemplateRow) });
}

async function saveTemplate(request, env, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const ownerKey = cleanString(body.ownerKey || body.owner_key, 120);
  const templateName = cleanString(body.templateName || body.template_name, 160);
  const description = cleanString(body.description, 500);
  const templateId = cleanString(body.templateId || body.template_id, 80);
  const mapping = normalizeMapping(body.mappingJson ?? body.mapping_json);
  if (!ownerKey || !templateName) return json({ ok: false, error: 'ownerKey va templateName la bat buoc' }, 400);
  if (!Object.keys(mapping).length) return json({ ok: false, error: 'Mapping khong hop le' }, 400);

  const now = nowIso();
  const oldRow = templateId ? await getImportTemplateSQL(env.DB, templateId) : null;
  const row = {
    template_id: oldRow ? oldRow.template_id : makeId('IMPTPL'),
    owner_key: ownerKey,
    template_name: templateName,
    description,
    mapping_json: JSON.stringify(mapping),
    created_by: oldRow?.created_by || actor.id,
    created_at: oldRow?.created_at || now,
    updated_at: now,
  };
  if (oldRow) await updateImportTemplateSQL(env.DB, row);
  else await insertImportTemplateSQL(env.DB, row);
  return json({ ok: true, template: parseTemplateRow(row) });
}

async function commitRows(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 80);
  const rfq = rfqId ? await getRfqSQL(env.DB, rfqId) : null;
  if (!rfq) return json({ ok: false, error: 'RFQ khong ton tai' }, 400);

  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
  if (!rows.length) return json({ ok: false, error: 'Khong co dong import' }, 400);

  const now = nowIso();
  const jobId = makeId('IMPJOB');
  const summary = {
    jobId,
    totalRows: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    rowErrors: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const sourceRow = rows[i] || {};
    const sourceRowNumber = positiveInt(sourceRow.sourceRowNumber ?? sourceRow.source_row_number) || i + 2;
    const rawRow = objectOnly(sourceRow.rawRow ?? sourceRow.raw_row);
    const mapped = sanitizeMapped(sourceRow.mapped || {});
    let status = 'created';
    let errorMessage = '';
    let rfqItemId = '';

    try {
      if (!mapped.ten_vat_tu) {
        status = 'error';
        errorMessage = 'Thieu ten_vat_tu';
        summary.errors++;
      } else {
        const oldRow = await resolveExistingItem(env.DB, rfqId, mapped);
        const itemRow = await buildImportItemRow(env.DB, {
          rfqId,
          mapped,
          oldRow,
          rawRow,
          sourceRowNumber,
          now,
        });
        if (oldRow) {
          await updateRfqItemSQL(env.DB, itemRow);
          status = 'updated';
          summary.updated++;
        } else {
          await insertRfqItemSQL(env.DB, itemRow);
          status = 'created';
          summary.created++;
        }
        rfqItemId = itemRow.rfq_item_id;
      }
    } catch (err) {
      status = 'error';
      errorMessage = err.message || String(err);
      summary.errors++;
    }

    if (status === 'error') {
      summary.rowErrors.push({ sourceRowNumber, error: errorMessage });
    }

    await insertImportJobRowSQL(env.DB, {
      job_row_id: makeId('IMPROW'),
      job_id: jobId,
      source_row_number: sourceRowNumber,
      raw_row_json: JSON.stringify(rawRow),
      mapped_json: JSON.stringify(mapped),
      status,
      error_message: errorMessage,
      rfq_id: rfqId,
      rfq_item_id: rfqItemId,
      created_at: now,
    });
  }

  summary.skipped = rows.length - summary.created - summary.updated - summary.errors;
  await insertImportJobSQL(env.DB, {
    job_id: jobId,
    owner_key: cleanString(body.ownerKey || body.owner_key, 120),
    rfq_id: rfqId,
    source_file_name: cleanString(body.sourceFileName || body.source_file_name, 180),
    source_sheet_name: 'csv',
    status: summary.errors ? 'completed_with_errors' : 'completed',
    total_rows: rows.length,
    created_count: summary.created,
    updated_count: summary.updated,
    skipped_count: summary.skipped,
    error_count: summary.errors,
    created_by: actor.id,
    created_at: now,
    committed_at: now,
  });

  ctx.waitUntil(invalidateKv(env, ['dashboard:v1']));
  ctx.waitUntil(writeActionLog(env, {
    action: 'commitImportRows',
    entityType: 'import_job',
    entityId: jobId,
    newJson: summary,
    actor,
  }));
  return json({ ok: true, summary });
}

async function getJob(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const jobId = cleanString(body.jobId || body.job_id, 80);
  if (!jobId) return json({ ok: false, error: 'Thieu jobId' }, 400);
  const job = await getImportJobSQL(env.DB, jobId);
  if (!job) return json({ ok: false, error: 'Khong tim thay import job' }, 404);
  return json({ ok: true, job });
}

async function getJobRows(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const jobId = cleanString(body.jobId || body.job_id, 80);
  if (!jobId) return json({ ok: false, error: 'Thieu jobId' }, 400);
  const rows = await listImportJobRowsSQL(env.DB, { jobId, limit: clampLimit(body.limit, 100, 500) });
  return json({ ok: true, rows });
}

function parseTemplateRow(row) {
  let mappingJson = {};
  try {
    mappingJson = JSON.parse(row.mapping_json || '{}');
  } catch {
    mappingJson = {};
  }
  return { ...row, mappingJson };
}

function normalizeMapping(value) {
  const raw = typeof value === 'string' ? safeJson(value) : objectOnly(value);
  const out = {};
  for (const [sourceHeader, targetField] of Object.entries(raw)) {
    const source = cleanString(sourceHeader, 180);
    const target = cleanString(targetField, 80);
    if (source && TARGET_FIELDS.has(target)) out[source] = target;
  }
  return out;
}

function sanitizeMapped(mapped) {
  const source = objectOnly(mapped);
  const out = {};
  for (const field of TARGET_FIELDS) {
    if (source[field] === undefined || source[field] === null) continue;
    if (field === 'quantity') out[field] = numberOrEmpty(source[field]);
    else if (field === 'don_gia_sau_thue' || field === 'thanh_tien_sau_thue') out[field] = moneyOrEmpty(source[field]);
    else out[field] = cleanString(source[field], field === 'origin_full_text' || field === 'yeu_cau_ky_thuat_bo_sung' ? 1500 : 500);
  }
  return out;
}

async function resolveExistingItem(db, rfqId, mapped) {
  const explicitId = cleanString(mapped.rfq_item_id, 80);
  if (explicitId) {
    const row = await getRfqItemSQL(db, explicitId);
    if (!row) throw new Error(`Khong tim thay rfq_item_id ${explicitId}`);
    if (row.rfq_id !== rfqId) throw new Error(`rfq_item_id ${explicitId} khong thuoc RFQ dang import`);
    return row;
  }
  return findDuplicateRfqItemSQL(db, {
    rfqId,
    maVatTu: cleanString(mapped.ma_vat_tu, 120),
    sttGoc: cleanString(mapped.stt_goc, 40),
  });
}

async function buildImportItemRow(db, { rfqId, mapped, oldRow, rawRow, sourceRowNumber, now }) {
  const row = oldRow ? { ...oldRow } : emptyItemRow();
  row.rfq_item_id = oldRow ? oldRow.rfq_item_id : await nextEntityId(db, 'rfq_items', 'rfq_item_id', 'RFQI');
  row.rfq_id = rfqId;
  row.created_at = oldRow?.created_at || now;
  row.updated_at = now;
  row.source_sheet_name = 'csv';
  row.source_row_number = sourceRowNumber;
  row.raw_row_json = JSON.stringify(rawRow);

  setText(row, mapped, 'stt_goc', 'stt_goc');
  setText(row, mapped, 'ma_vat_tu', 'ma_vat_tu');
  setText(row, mapped, 'ten_vat_tu', 'ten_vat_tu');
  setText(row, mapped, 'required_model', 'required_model');
  setText(row, mapped, 'manufacturer', 'manufacturer');
  setText(row, mapped, 'brand', 'brand');
  setText(row, mapped, 'origin_country', 'origin_country');
  setText(row, mapped, 'unit', 'unit');
  setText(row, mapped, 'yeu_cau_ky_thuat_bo_sung', 'yeu_cau_ky_thuat_bo_sung');
  setText(row, mapped, 'delivery_time', 'delivery_time');
  setText(row, mapped, 'origin_full_text', 'origin_full_text');
  setNumber(row, mapped, 'quantity', 'quantity');
  setMoney(row, mapped, 'don_gia_sau_thue', 'don_gia_sau_thue');
  setMoney(row, mapped, 'thanh_tien_sau_thue', 'thanh_tien_sau_thue');

  row.quy_cach_model_yeu_cau = row.required_model;
  row.hang_goc_nsx_goc = row.manufacturer;
  row.nhan_hieu = row.brand;
  row.xuat_xu = row.origin_country;
  row.thong_so_ky_thuat = row.technical_params || '';
  row.so_luong = row.quantity || 0;
  row.don_vi = row.unit;
  row.normalized_search = buildSearchText([
    row.ma_mua_sam, row.ma_vat_tu, row.ten_vat_tu, row.required_model,
    row.brand, row.manufacturer, row.origin_country, row.manufacture_year,
    row.technical_params, row.vat_lieu, row.yeu_cau_ky_thuat_bo_sung,
  ]);
  return row;
}

function emptyItemRow() {
  return {
    rfq_item_id: '',
    rfq_id: '',
    stt_goc: '',
    id_import_goc: '',
    ma_mua_sam: '',
    ma_vat_tu: '',
    ten_vat_tu: '',
    required_model: '',
    brand: '',
    manufacture_year: '',
    origin_country: '',
    manufacturer: '',
    technical_params: '',
    unit: '',
    quantity: 0,
    origin_full_text: '',
    delivery_time: '',
    note: '',
    quy_cach_model_yeu_cau: '',
    hang_goc_nsx_goc: '',
    hang_bao_gia_nsx_bao_gia: '',
    nhan_hieu: '',
    xuat_xu: '',
    nam_san_xuat: '',
    vat_lieu: '',
    phu_tung_chuyen_dung: '',
    thong_so_ky_thuat: '',
    yeu_cau_ky_thuat_bo_sung: '',
    so_luong: 0,
    don_vi: '',
    thue_suat: 0,
    don_gia_truoc_thue: 0,
    don_gia_sau_thue: 0,
    thanh_tien_sau_thue: 0,
    nguon_gia: '',
    trang_thai_dong: 'chua_xu_ly',
    trang_thai_ky_thuat: 'khong_can_xac_nhan',
    quy_cach_final: '',
    hang_final: '',
    xuat_xu_final: '',
    ghi_chu_final: '',
    item_id: '',
    normalized_search: '',
    raw_row_json: '',
    source_file_id: '',
    source_sheet_name: '',
    source_row_number: 0,
    created_at: '',
    updated_at: '',
  };
}

function setText(row, mapped, field, target) {
  if (mapped[field] !== undefined && mapped[field] !== '') row[target] = cleanString(mapped[field], TEXT_FIELDS.includes(field) ? 1500 : 500);
}

function setNumber(row, mapped, field, target) {
  if (mapped[field] !== undefined && mapped[field] !== '') row[target] = cleanNumber(mapped[field]);
}

function setMoney(row, mapped, field, target) {
  if (mapped[field] !== undefined && mapped[field] !== '') row[target] = cleanMoney(mapped[field]);
}

function objectOnly(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function positiveInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function numberOrEmpty(value) {
  return value === '' || value === null || value === undefined ? '' : cleanNumber(value);
}

function moneyOrEmpty(value) {
  return value === '' || value === null || value === undefined ? '' : cleanMoney(value);
}
