import {
  archiveClientBankAccountSQL,
  clearPrimaryBankAccountSQL,
  getClientBankAccountSQL,
  insertClientBankAccountSQL,
  listClientBankAccountsSQL,
  updateClientBankAccountSQL,
} from '../db/client-bank-account-queries.js';
import { ALL_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanString } from '../lib/normalize.js';
import { json, makeId, nowIso, readJson } from '../lib/utils.js';

const VALID_CURRENCIES = new Set(['VND', 'USD', 'EUR']);

export async function handleClientBankAccounts(action, request, env, ctx, actor) {
  if (action === 'getClientBankAccounts')    return listBankAccounts(request, env, actor);
  if (action === 'createClientBankAccount')  return saveBankAccount(request, env, ctx, actor, false);
  if (action === 'updateClientBankAccount')  return saveBankAccount(request, env, ctx, actor, true);
  if (action === 'archiveClientBankAccount') return archiveBankAccount(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown bank account action' }, 400);
}

async function listBankAccounts(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  if (!p.clientId) return json({ ok: false, error: 'clientId la bat buoc' }, 400);
  const data = await listClientBankAccountsSQL(env.DB, { clientId: p.clientId });
  return json({ ok: true, ...data });
}

async function saveBankAccount(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);

  const clientId = cleanString(body.clientId || body.client_id, 50);
  if (!clientId) return json({ ok: false, error: 'clientId la bat buoc' }, 400);
  const bankAccount = cleanString(body.bankAccount || body.bank_account, 100);
  if (!bankAccount) return json({ ok: false, error: 'bank_account la bat buoc' }, 400);
  const bankName = cleanString(body.bankName || body.bank_name, 200);
  if (!bankName) return json({ ok: false, error: 'bank_name la bat buoc' }, 400);
  const currency = (body.currency || 'VND').toUpperCase();
  const now = nowIso();
  const cs = (val, max) => cleanString(val, max);
  const isPrimary = (body.isPrimary === '1' || body.isPrimary === 1 || body.is_primary === 1) ? 1 : 0;

  const oldRow = isUpdate ? await getClientBankAccountSQL(env.DB, body.bankAccountId || body.bank_account_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: 'Khong tim thay tai khoan ngan hang' }, 404);

  if (isPrimary) await clearPrimaryBankAccountSQL(env.DB, clientId);

  const row = {
    bank_account_id: isUpdate ? oldRow.bank_account_id : makeId('BK'),
    client_id:       isUpdate ? oldRow.client_id : clientId,
    account_name:    cs(body.accountName || body.account_name, 200),
    bank_account:    bankAccount,
    bank_name:       bankName,
    branch_name:     cs(body.branchName || body.branch_name, 200),
    currency:        VALID_CURRENCIES.has(currency) ? currency : 'VND',
    is_primary:      isPrimary,
    status:          isUpdate ? (oldRow.status || 'active') : 'active',
    note:            cs(body.note, 1000),
    created_by:      isUpdate ? oldRow.created_by : (actor?.id || ''),
    created_at:      isUpdate ? oldRow.created_at : now,
    updated_at:      now,
  };

  if (isUpdate) await updateClientBankAccountSQL(env.DB, row);
  else await insertClientBankAccountSQL(env.DB, row);

  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? 'updateClientBankAccount' : 'createClientBankAccount',
    entityType: 'client_bank_account',
    entityId: row.bank_account_id,
    oldJson: oldRow,
    newJson: row,
    actor,
  }));
  return json({ ok: true, bankAccount: row });
}

async function archiveBankAccount(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const id = cleanString(body.bankAccountId || body.bank_account_id, 50);
  if (!id) return json({ ok: false, error: 'bankAccountId la bat buoc' }, 400);
  const oldRow = await getClientBankAccountSQL(env.DB, id);
  if (!oldRow) return json({ ok: false, error: 'Khong tim thay tai khoan ngan hang' }, 404);
  const now = nowIso();
  await archiveClientBankAccountSQL(env.DB, id, now);
  ctx.waitUntil(writeActionLog(env, {
    action: 'archiveClientBankAccount',
    entityType: 'client_bank_account',
    entityId: id,
    oldJson: oldRow,
    newJson: { ...oldRow, status: 'archived', updated_at: now },
    actor,
  }));
  return json({ ok: true });
}
