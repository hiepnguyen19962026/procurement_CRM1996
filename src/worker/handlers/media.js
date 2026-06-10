import { insertMediaFileSQL, listMediaFilesSQL } from '../db/media-queries.js';
import { ALL_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanString } from '../lib/normalize.js';
import { clampLimit, json, makeId, nowIso, readJson } from '../lib/utils.js';

const UPLOAD_ROLES = new Set(['admin', 'manager', 'purchasing']);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOADS = new Set(['quote:quote_pdf', 'rfq_item:document_pdf']);

export async function handleMedia(action, request, env, ctx, actor) {
  if (action === 'getMediaFiles') return listMedia(request, env, actor);
  if (action === 'uploadMedia') return uploadMedia(request, env, ctx, actor);
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
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return json({ ok: false, error: 'Thieu file upload' }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ ok: false, error: 'File toi da 10MB trong Upload V1' }, 400);
  const browserType = cleanString(file.type || '', 120).toLowerCase();
  if (browserType && browserType !== 'application/pdf') {
    return json({ ok: false, error: 'Upload V1 chi chap nhan PDF' }, 400);
  }

  const ownerType = cleanString(form.get('ownerType') || form.get('owner_type'), 40);
  const ownerId = cleanString(form.get('ownerId') || form.get('owner_id'), 120);
  const fileKind = cleanString(form.get('fileKind') || form.get('file_kind'), 40);
  if (!ownerType || !ownerId || !fileKind) {
    return json({ ok: false, error: 'Thieu ownerType, ownerId hoac fileKind' }, 400);
  }
  if (!ALLOWED_UPLOADS.has(`${ownerType}:${fileKind}`)) {
    return json({ ok: false, error: 'Loai file upload khong duoc ho tro trong V1' }, 400);
  }

  const bytes = await file.arrayBuffer();
  if (!isPdf(bytes)) return json({ ok: false, error: 'File khong phai PDF hop le' }, 400);

  const fileId = makeId('FILE');
  const displayName = sanitizeDisplayName(file.name);
  const safeBaseName = safePdfBaseName(displayName);
  const key = `media/${ownerType}/${ownerId}/${fileKind}/${fileId}-${safeBaseName}.pdf`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
  const row = {
    file_id: fileId,
    owner_type: ownerType,
    owner_id: ownerId,
    file_kind: fileKind,
    r2_key: key,
    public_url: '',
    file_name: displayName,
    mime_type: 'application/pdf',
    size_bytes: file.size || 0,
    width: 0,
    height: 0,
    variant: 'original',
    is_primary: 0,
    created_by: actor.id,
    created_at: nowIso(),
  };
  await insertMediaFileSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: 'uploadMedia',
    entityType: 'media_file',
    entityId: fileId,
    message: `${actor.displayName || actor.username || actor.id} uploaded ${ownerType}/${ownerId}/${fileKind}`,
    newJson: row,
    actor,
  }));
  return json({ ok: true, file: compactMediaRow(row) });
}

function isPdf(buffer) {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d;
}

function sanitizeDisplayName(name) {
  const raw = String(name || 'document.pdf')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, ' ')
    .trim();
  const safe = raw.replace(/\s+/g, ' ').slice(0, 160).trim();
  const base = (safe || 'document.pdf').replace(/\.[^.]*$/, '').trim() || 'document';
  return `${base}.pdf`;
}

function safePdfBaseName(displayName) {
  const noExt = displayName.replace(/\.[^.]*$/, '');
  const ascii = noExt
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .replace(/_+/g, '_')
    .slice(0, 100)
    .replace(/^_+|_+$/g, '');
  return ascii || 'document';
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
    created_by: row.created_by,
    created_at: row.created_at,
  };
}
