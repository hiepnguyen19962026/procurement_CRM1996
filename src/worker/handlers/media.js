import { insertMediaFileSQL, listMediaFilesSQL } from '../db/media-queries.js';
import { ALL_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanString } from '../lib/normalize.js';
import { clampLimit, json, makeId, nowIso, readJson } from '../lib/utils.js';

export async function handleMedia(action, request, env, ctx, actor) {
  if (action === 'getMediaFiles') return listMedia(request, env, actor);
  if (action === 'uploadMedia') return uploadMedia(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown media action' }, 400);
}

async function listMedia(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const rows = await listMediaFilesSQL(env.DB, {
    ownerType: cleanString(p.ownerType || p.owner_type, 40),
    ownerId: cleanString(p.ownerId || p.owner_id, 120),
    limit: clampLimit(p.limit, 50, 100),
  });
  return json({ ok: true, rows });
}

async function uploadMedia(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  if (!env.MEDIA) return json({ ok: false, error: 'R2 MEDIA binding chua cau hinh' }, 500);
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return json({ ok: false, error: 'Thieu file upload' }, 400);
  if (file.size > 8 * 1024 * 1024) return json({ ok: false, error: 'File toi da 8MB trong Phase 1' }, 400);
  const ownerType = cleanString(form.get('ownerType') || form.get('owner_type') || 'rfq', 40);
  const ownerId = cleanString(form.get('ownerId') || form.get('owner_id'), 120);
  const fileKind = cleanString(form.get('fileKind') || form.get('file_kind') || 'other', 40);
  const fileId = makeId('FILE');
  const safeName = cleanString(file.name || 'upload.bin', 180).replace(/[^\w.\-]+/g, '_');
  const key = `media/${ownerType}/${ownerId || 'unassigned'}/${fileId}-${safeName}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  const row = {
    file_id: fileId,
    owner_type: ownerType,
    owner_id: ownerId,
    file_kind: fileKind,
    r2_key: key,
    public_url: env.MEDIA_PUBLIC_URL ? `${String(env.MEDIA_PUBLIC_URL).replace(/\/$/, '')}/${key}` : '',
    file_name: safeName,
    mime_type: file.type || 'application/octet-stream',
    size_bytes: file.size || 0,
    width: 0,
    height: 0,
    variant: 'original',
    is_primary: 0,
    created_by: actor.id,
    created_at: nowIso(),
  };
  await insertMediaFileSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, { action: 'uploadMedia', entityType: ownerType, entityId: ownerId, newJson: row, actor }));
  return json({ ok: true, file: row });
}
