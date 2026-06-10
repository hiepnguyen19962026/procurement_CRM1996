import {
  archiveClientContactSQL,
  clearPrimaryContactSQL,
  getClientContactSQL,
  insertClientContactSQL,
  listClientContactsSQL,
  updateClientContactSQL,
} from '../db/client-contact-queries.js';
import { ALL_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { buildSearchText, cleanString, normalizeText } from '../lib/normalize.js';
import { json, makeId, nowIso, readJson } from '../lib/utils.js';

const VALID_ROLE_TYPES = new Set([
  'technical', 'procurement', 'commercial', 'finance', 'safety', 'production', 'management', 'other',
]);

export async function handleClientContacts(action, request, env, ctx, actor) {
  if (action === 'getClientContacts')     return listContacts(request, env, actor);
  if (action === 'createClientContact')   return saveContact(request, env, ctx, actor, false);
  if (action === 'updateClientContact')   return saveContact(request, env, ctx, actor, true);
  if (action === 'archiveClientContact')  return archiveContact(request, env, ctx, actor);
  if (action === 'importClientContacts')  return importContacts(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown contact action' }, 400);
}

async function listContacts(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  if (!p.clientId) return json({ ok: false, error: 'clientId la bat buoc' }, 400);
  const data = await listClientContactsSQL(env.DB, { clientId: p.clientId });
  return json({ ok: true, ...data });
}

async function saveContact(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);

  const clientId = cleanString(body.clientId || body.client_id, 50);
  if (!clientId) return json({ ok: false, error: 'clientId la bat buoc' }, 400);
  const contactName = cleanString(body.contactName || body.contact_name, 200);
  if (!contactName) return json({ ok: false, error: 'contact_name la bat buoc' }, 400);
  const roleType = (body.roleType || body.role_type || 'other').toLowerCase();
  if (!VALID_ROLE_TYPES.has(roleType)) return json({ ok: false, error: `role_type khong hop le` }, 400);

  const now = nowIso();
  const cs = (val, max) => cleanString(val, max);
  const isPrimary = (body.isPrimary === '1' || body.isPrimary === 1 || body.is_primary === 1) ? 1 : 0;

  const oldRow = isUpdate ? await getClientContactSQL(env.DB, body.contactId || body.contact_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: 'Khong tim thay lien he' }, 404);

  if (isPrimary) await clearPrimaryContactSQL(env.DB, clientId);

  const row = {
    contact_id:     isUpdate ? oldRow.contact_id : makeId('CC'),
    client_id:      isUpdate ? oldRow.client_id : clientId,
    contact_name:   contactName,
    department:     cs(body.department, 150),
    position:       cs(body.position, 150),
    role_type:      roleType,
    specialty_tags: cs(body.specialtyTags || body.specialty_tags, 500),
    phone:          cs(body.phone, 50),
    email:          cs(body.email, 200),
    zalo:           cs(body.zalo, 100),
    note:           cs(body.note, 1000),
    is_primary:     isPrimary,
    status:         isUpdate ? (oldRow.status || 'active') : 'active',
    created_by:     isUpdate ? oldRow.created_by : (actor?.id || ''),
    created_at:     isUpdate ? oldRow.created_at : now,
    updated_at:     now,
  };

  if (isUpdate) await updateClientContactSQL(env.DB, row);
  else await insertClientContactSQL(env.DB, row);

  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? 'updateClientContact' : 'createClientContact',
    entityType: 'client_contact',
    entityId: row.contact_id,
    oldJson: oldRow,
    newJson: row,
    actor,
  }));
  return json({ ok: true, contact: row });
}

async function archiveContact(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const id = cleanString(body.contactId || body.contact_id, 50);
  if (!id) return json({ ok: false, error: 'contactId la bat buoc' }, 400);
  const oldRow = await getClientContactSQL(env.DB, id);
  if (!oldRow) return json({ ok: false, error: 'Khong tim thay lien he' }, 404);
  const now = nowIso();
  await archiveClientContactSQL(env.DB, id, now);
  ctx.waitUntil(writeActionLog(env, {
    action: 'archiveClientContact',
    entityType: 'client_contact',
    entityId: id,
    oldJson: oldRow,
    newJson: { ...oldRow, status: 'archived', updated_at: now },
    actor,
  }));
  return json({ ok: true });
}

async function importContacts(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const clientId = cleanString(body.clientId || body.client_id, 50);
  if (!clientId) return json({ ok: false, error: 'clientId la bat buoc' }, 400);
  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  if (!rawRows.length) return json({ ok: false, error: 'Khong co du lieu de nhap' }, 400);
  if (rawRows.length > 200) return json({ ok: false, error: 'Toi da 200 dong moi lan nhap' }, 400);

  const now = nowIso();
  const results = { created: 0, errors: [] };
  const cs = (val, max) => cleanString(val, max);

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const contactName = cs(r.contact_name, 200);
    if (!contactName) { results.errors.push(`Dong ${i + 1}: contact_name trong`); continue; }
    const roleType = String(r.role_type || 'other').trim().toLowerCase();
    if (!VALID_ROLE_TYPES.has(roleType)) { results.errors.push(`Dong ${i + 1}: role_type "${roleType}" khong hop le`); continue; }
    const row = {
      contact_id:     makeId('CC'),
      client_id:      clientId,
      contact_name:   contactName,
      department:     cs(r.department, 150),
      position:       cs(r.position, 150),
      role_type:      roleType,
      specialty_tags: cs(r.specialty_tags, 500),
      phone:          cs(r.phone, 50),
      email:          cs(r.email, 200),
      zalo:           cs(r.zalo, 100),
      note:           cs(r.note, 1000),
      is_primary:     0,
      status:         'active',
      created_by:     actor?.id || '',
      created_at:     now,
      updated_at:     now,
    };
    try {
      await insertClientContactSQL(env.DB, row);
      results.created++;
    } catch (err) {
      results.errors.push(`Dong ${i + 1}: ${err.message || 'loi khi luu'}`);
    }
  }

  if (results.created > 0) {
    ctx.waitUntil(writeActionLog(env, {
      action: 'importClientContacts',
      entityType: 'client_contact',
      entityId: clientId,
      newJson: { clientId, created: results.created },
      actor,
    }));
  }
  return json({ ok: true, ...results });
}
