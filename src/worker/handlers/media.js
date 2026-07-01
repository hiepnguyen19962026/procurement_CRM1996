import { deleteMediaFileSQL, getCalendarEventOwnerSQL, getMediaFileSQL, insertMediaFileSQL, listMediaFilesSQL, mediaOwnerExistsSQL } from '../db/media-queries.js';
import { ALL_ROLES, MANAGE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { consumeKvRateLimit } from '../lib/cache.js';
import { cleanString } from '../lib/normalize.js';
import { clampLimit, json, makeId, nowIso, readJson } from '../lib/utils.js';

const UPLOAD_ROLES = new Set(['admin', 'manager', 'purchasing']);
const DELETE_MEDIA_ROLES = new Set(['admin', 'manager', 'purchasing']);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOADS = new Set([
  'quote:quote_pdf',
  'quote:quote_evidence_image',
  'rfq_item:document_pdf',
  'rfq_item:item_image',
  'calendar_event:calendar_evidence_image',
  'calendar_event:calendar_document_pdf',
]);
const PDF_KINDS = new Set(['quote_pdf', 'document_pdf', 'calendar_document_pdf']);
const IMAGE_KINDS = new Set(['item_image', 'quote_evidence_image', 'calendar_evidence_image']);

export async function handleMedia(action, request, env, ctx, actor) {
  if (action === 'getMediaFiles') return listMedia(request, env, actor);
  if (action === 'uploadMedia') return uploadMedia(request, env, ctx, actor);
  if (action === 'getMediaFileContent') return getMediaContent(request, env, ctx, actor);
  if (action === 'deleteMediaFile') return deleteMediaFile(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown media action' }, 400);
}

async function listMedia(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const ownerType = cleanString(p.ownerType || p.owner_type, 40);
  const ownerId = cleanString(p.ownerId || p.owner_id, 120);
  if (!ownerType || !ownerId) return json({ ok: false, error: 'Thieu ownerType hoac ownerId' }, 400);
  const rows = await listMediaFilesSQL(env.DB, {
    ownerType,
    ownerId,
    limit: clampLimit(p.limit, 50, 100),
  });
  return json({ ok: true, rows: rows.map(compactMediaRow) });
}

async function uploadMedia(request, env, ctx, actor) {
  const denied = requireRole(actor, UPLOAD_ROLES);
  if (denied) return denied;
  if (!env.MEDIA) return json({ ok: false, error: 'R2 MEDIA binding chua cau hinh' }, 500);
  const rate = await consumeKvRateLimit(env, `s2b1:uploadMedia:actor:${actor.id}`, 20, 600);
  if (!rate.allowed) return json({ ok: false, error: 'Qua nhieu yeu cau upload', retryAfter: rate.retryAfter }, 429, { 'retry-after': String(rate.retryAfter) });
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return json({ ok: false, error: 'Thieu file upload' }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ ok: false, error: 'File toi da 10MB' }, 400);
  const browserType = cleanString(file.type || '', 120).toLowerCase();

  const ownerType = cleanString(form.get('ownerType') || form.get('owner_type'), 40);
  const ownerId = cleanString(form.get('ownerId') || form.get('owner_id'), 120);
  const fileKind = cleanString(form.get('fileKind') || form.get('file_kind'), 40);
  if (!ownerType || !ownerId || !fileKind) {
    return json({ ok: false, error: 'Thieu ownerType, ownerId hoac fileKind' }, 400);
  }
  if (!ALLOWED_UPLOADS.has(`${ownerType}:${fileKind}`)) {
    return json({ ok: false, error: 'Loai file upload khong duoc ho tro' }, 400);
  }
  if (!await mediaOwnerExistsSQL(env.DB, ownerType, ownerId)) {
    return json({ ok: false, error: 'Khong tim thay doi tuong so huu file' }, 404);
  }

  const bytes = await file.arrayBuffer();
  const detected = detectFileType(bytes);
  const uploadType = validateUploadType(fileKind, browserType, detected);
  if (uploadType.error) return json({ ok: false, error: uploadType.error }, 400);

  const fileId = makeId('FILE');
  const displayName = sanitizeDisplayName(file.name, uploadType.extension);
  const safeBaseName = safeBaseNameFromDisplay(displayName);
  const key = `media/${ownerType}/${ownerId}/${fileKind}/${fileId}-${safeBaseName}.${uploadType.extension}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: uploadType.mimeType } });
  const row = {
    file_id: fileId,
    owner_type: ownerType,
    owner_id: ownerId,
    file_kind: fileKind,
    r2_key: key,
    // public_url must stay empty. Files are private; access only via /api/media?fileId= (JWT auth).
    // Never store r2.dev URLs or custom domain URLs here.
    public_url: '',
    file_name: displayName,
    mime_type: uploadType.mimeType,
    size_bytes: file.size || 0,
    width: positiveInt(form.get('width')),
    height: positiveInt(form.get('height')),
    variant: 'original',
    is_primary: 0,
    created_by: actor.id,
    created_at: nowIso(),
  };
  try {
    await insertMediaFileSQL(env.DB, row);
  } catch (err) {
    await env.MEDIA.delete(key).catch(() => null);
    throw err;
  }
  ctx.waitUntil(writeActionLog(env, {
    action: 'uploadMedia',
    entityType: 'media_file',
    entityId: fileId,
    message: `${actor.displayName || actor.username || actor.id} uploaded ${ownerType}/${ownerId}/${fileKind}`,
    newJson: compactMediaRow(row),
    actor,
  }));
  return json({ ok: true, file: compactMediaRow(row) });
}

async function getMediaContent(request, env, ctx, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  if (!env.MEDIA) return json({ ok: false, error: 'R2 MEDIA binding chua cau hinh' }, 500);
  const p = await readJson(request);
  const fileId = cleanString(p.fileId || p.file_id, 80);
  const ownerType = cleanString(p.ownerType || p.owner_type, 40);
  const ownerId = cleanString(p.ownerId || p.owner_id, 120);
  if (!fileId || !ownerType || !ownerId) return json({ ok: false, error: 'Thieu ownerType, ownerId hoac fileId' }, 400);
  const row = await getMediaFileSQL(env.DB, fileId, ownerType, ownerId);
  if (!row) return json({ ok: false, error: 'Khong tim thay file' }, 404);
  const object = await env.MEDIA.get(row.r2_key);
  if (!object) return json({ ok: false, error: 'File khong con trong R2' }, 404);
  ctx.waitUntil(writeActionLog(env, {
    action: 'downloadMedia',
    entityType: 'media_file',
    entityId: row.file_id,
    message: `${actor.displayName || actor.username || actor.id} downloaded ${row.owner_type}/${row.owner_id}/${row.file_kind}: ${row.file_name || row.file_id}`,
    actor,
  }));
  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': row.mime_type || object.httpMetadata?.contentType || 'application/octet-stream',
      'content-disposition': `inline; filename="${contentDispositionName(row.file_name || row.file_id)}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function deleteMediaFile(request, env, ctx, actor) {
  const denied = requireRole(actor, DELETE_MEDIA_ROLES);
  if (denied) return denied;
  if (!env.MEDIA) return json({ ok: false, error: 'R2 MEDIA binding chua cau hinh' }, 500);
  const p = await readJson(request);
  const fileId = cleanString(p.fileId || p.file_id, 80);
  const ownerType = cleanString(p.ownerType || p.owner_type, 40);
  const ownerId = cleanString(p.ownerId || p.owner_id, 120);
  if (!fileId || !ownerType || !ownerId) {
    return json({ ok: false, error: 'Thieu ownerType, ownerId hoac fileId' }, 400);
  }
  if (ownerType !== 'calendar_event') {
    return json({ ok: false, error: 'Loai file nay chua ho tro xoa rieng' }, 400);
  }
  const row = await getMediaFileSQL(env.DB, fileId, ownerType, ownerId);
  if (!row) return json({ ok: false, error: 'Khong tim thay file' }, 404);
  const event = await getCalendarEventOwnerSQL(env.DB, ownerId);
  if (!event) return json({ ok: false, error: 'Khong tim thay lich' }, 404);
  if (!MANAGE_ROLES.has(actor.role) && event.owner_id !== actor.id) {
    return json({ ok: false, error: 'Khong co quyen xoa file cua lich nay' }, 403);
  }

  await env.MEDIA.delete(row.r2_key);
  await deleteMediaFileSQL(env.DB, fileId, ownerType, ownerId);
  ctx.waitUntil(writeActionLog(env, {
    action: 'deleteMediaFile',
    entityType: 'media_file',
    entityId: fileId,
    message: `${actor.displayName || actor.username || actor.id} deleted ${ownerType}/${ownerId}/${row.file_name || fileId}`,
    oldJson: compactMediaRow(row),
    newJson: null,
    actor,
  }));
  return json({ ok: true, fileId });
}

function validateUploadType(fileKind, browserType, detected) {
  if (PDF_KINDS.has(fileKind)) {
    if (browserType && browserType !== 'application/pdf') return { error: 'File PDF phai co MIME application/pdf' };
    if (detected !== 'pdf') return { error: 'File khong phai PDF hop le' };
    return { mimeType: 'application/pdf', extension: 'pdf' };
  }
  if (IMAGE_KINDS.has(fileKind)) {
    if (browserType && !['image/jpeg', 'image/png', 'image/webp'].includes(browserType)) {
      return { error: 'Anh chi chap nhan JPEG, PNG hoac WebP' };
    }
    if (!['jpeg', 'png', 'webp'].includes(detected)) {
      return { error: 'Anh khong dung dinh dang JPEG, PNG hoac WebP' };
    }
    if (detected === 'png') {
      return { error: 'Anh PNG phai duoc toi uu qua trinh duyet thanh JPEG truoc khi luu' };
    }
    return {
      mimeType: detected === 'webp' ? 'image/webp' : 'image/jpeg',
      extension: detected === 'webp' ? 'webp' : 'jpg',
    };
  }
  return { error: 'Loai file upload khong duoc ho tro' };
}

function detectFileType(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d) return 'pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a) return 'png';
  if (bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50) return 'webp';
  if (bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61) return 'gif';
  return 'unknown';
}

function sanitizeDisplayName(name, extension) {
  const safeExtension = extension === 'webp' ? 'webp' : extension === 'png' ? 'png' : extension === 'jpg' ? 'jpg' : 'pdf';
  const fallback = safeExtension === 'pdf' ? 'document.pdf' : `image.${safeExtension}`;
  const raw = String(name || fallback)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, ' ')
    .trim();
  const safe = raw.replace(/\s+/g, ' ').slice(0, 160).trim();
  const base = (safe || fallback).replace(/\.[^.]*$/, '').trim() || (safeExtension === 'pdf' ? 'document' : 'image');
  return `${base}.${safeExtension}`;
}

function safeBaseNameFromDisplay(displayName) {
  const noExt = displayName.replace(/\.[^.]*$/, '');
  const ascii = noExt
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .replace(/_+/g, '_')
    .slice(0, 100)
    .replace(/^_+|_+$/g, '');
  return ascii || 'file';
}

function positiveInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function contentDispositionName(name) {
  return String(name || 'file')
    .replace(/[\u0000-\u001f\u007f"\\]/g, '')
    .replace(/[\\/]+/g, ' ')
    .trim()
    .slice(0, 160) || 'file';
}

function compactMediaRow(row) {
  return {
    file_id: row.file_id,
    owner_type: row.owner_type,
    owner_id: row.owner_id,
    file_kind: row.file_kind,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    width: row.width || 0,
    height: row.height || 0,
    variant: row.variant || 'original',
    is_primary: row.is_primary || 0,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}
