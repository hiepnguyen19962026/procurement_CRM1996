import {
  archiveRfqContactSQL,
  checkRfqContactExistsSQL,
  insertRfqContactSQL,
  listRfqContactsSQL,
} from '../db/rfq-contact-queries.js';
import { ALL_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanString } from '../lib/normalize.js';
import { json, makeId, nowIso, readJson } from '../lib/utils.js';

export async function handleRfqContacts(action, request, env, ctx, actor) {
  if (action === 'getRfqContacts')    return listContacts(request, env, actor);
  if (action === 'addRfqContact')     return addContact(request, env, ctx, actor);
  if (action === 'archiveRfqContact') return archiveContact(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown rfq contact action' }, 400);
}

async function listContacts(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  if (!p.rfqId) return json({ ok: false, error: 'rfqId la bat buoc' }, 400);
  const data = await listRfqContactsSQL(env.DB, { rfqId: p.rfqId });
  return json({ ok: true, ...data });
}

async function addContact(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 50);
  const clientId = cleanString(body.clientId || body.client_id, 50);
  const contactId = cleanString(body.contactId || body.contact_id, 50);
  if (!rfqId || !contactId || !clientId) return json({ ok: false, error: 'rfqId, clientId, contactId la bat buoc' }, 400);

  const exists = await checkRfqContactExistsSQL(env.DB, rfqId, contactId);
  if (exists) return json({ ok: false, error: 'Lien he nay da co trong goi RFQ' }, 409);

  const now = nowIso();
  const row = {
    rfq_contact_id: makeId('RC'),
    rfq_id:         rfqId,
    client_id:      clientId,
    contact_id:     contactId,
    support_role:   cleanString(body.supportRole || body.support_role, 150),
    note:           cleanString(body.note, 500),
    status:         'active',
    created_by:     actor?.id || '',
    created_at:     now,
  };

  await insertRfqContactSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: 'addRfqContact',
    entityType: 'rfq_contact',
    entityId: row.rfq_contact_id,
    newJson: row,
    actor,
  }));
  return json({ ok: true, rfqContact: row });
}

async function archiveContact(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const id = cleanString(body.rfqContactId || body.rfq_contact_id, 50);
  if (!id) return json({ ok: false, error: 'rfqContactId la bat buoc' }, 400);
  await archiveRfqContactSQL(env.DB, id);
  ctx.waitUntil(writeActionLog(env, {
    action: 'archiveRfqContact',
    entityType: 'rfq_contact',
    entityId: id,
    actor,
  }));
  return json({ ok: true });
}
