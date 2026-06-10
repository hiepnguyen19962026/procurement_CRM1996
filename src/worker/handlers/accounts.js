import { getUserByUsernameSQL, insertUserSQL, listUsersSQL, updatePasswordSQL, updateUserSQL } from '../db/account-queries.js';
import { ADMIN_ROLES, ALL_ROLES, hashPassword, requireRole, safeUser, verifyPassword } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanString } from '../lib/normalize.js';
import { clampLimit, json, makeId, nowIso, readJson } from '../lib/utils.js';

export async function handleAccounts(action, request, env, ctx, actor) {
  if (action === 'authLogin') return authLogin(request, env);
  if (action === 'initSetup') return initSetup(request, env);
  if (action === 'logout') return json({ ok: true });
  if (action === 'getSession') {
    const denied = requireRole(actor, ALL_ROLES);
    if (denied) return denied;
    return json({ ok: true, user: actor });
  }
  if (action === 'changePassword') return changePassword(request, env, ctx, actor);
  if (action === 'getAccounts') return listAccounts(request, env, actor);
  if (action === 'createAccount') return createAccount(request, env, ctx, actor);
  if (action === 'updateAccount') return updateAccount(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown account action' }, 400);
}

async function initSetup(request, env) {
  const body = await readJson(request);
  if (!env.SETUP_SECRET || body.setupSecret !== env.SETUP_SECRET) {
    return json({ ok: false, error: 'Setup secret khong hop le' }, 403);
  }
  const existing = await listUsersSQL(env.DB, { limit: 1, cursor: '' });
  if (existing.rows.length) return json({ ok: false, error: 'Da co user, khong the init lai' }, 409);
  const username = cleanString(body.username || 'admin', 80).toLowerCase();
  const password = String(body.password || '');
  if (!password || password.length < 8) return json({ ok: false, error: 'Mat khau admin toi thieu 8 ky tu' }, 400);
  const now = nowIso();
  const row = {
    user_id: makeId('USR'),
    username,
    display_name: cleanString(body.displayName || 'Admin', 120),
    password_hash: await hashPassword(password),
    role: 'admin',
    status: 'active',
    session_version: 1,
    created_at: now,
    updated_at: now,
  };
  await insertUserSQL(env.DB, row);
  return json({ ok: true, user: safeUser(row) });
}

async function authLogin(request, env) {
  const body = await readJson(request);
  const username = cleanString(body.username, 80).toLowerCase();
  const password = String(body.password || '');
  if (!username || !password) return json({ ok: false, error: 'Thieu tai khoan hoac mat khau' }, 400);
  const row = await getUserByUsernameSQL(env.DB, username);
  if (!row || row.status !== 'active') return json({ ok: false, error: 'Tai khoan khong hop le' }, 401);
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return json({ ok: false, error: 'Sai tai khoan hoac mat khau' }, 401);
  return json({ ok: true, user: safeUser(row) });
}

async function listAccounts(request, env, actor) {
  const denied = requireRole(actor, ADMIN_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const data = await listUsersSQL(env.DB, { limit: clampLimit(body.limit), cursor: body.cursor || '', sortBy: body.sortBy || '', sortDir: body.sortDir || '' });
  return json({ ok: true, ...data });
}

async function createAccount(request, env, ctx, actor) {
  const denied = requireRole(actor, ADMIN_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const username = cleanString(body.username, 80).toLowerCase();
  const role = cleanString(body.role, 20);
  if (!username || !body.password || !['admin', 'manager', 'purchasing', 'viewer'].includes(role)) {
    return json({ ok: false, error: 'Thong tin tai khoan khong hop le' }, 400);
  }
  const exists = await getUserByUsernameSQL(env.DB, username);
  if (exists) return json({ ok: false, error: 'Username da ton tai' }, 409);
  const now = nowIso();
  const row = {
    user_id: makeId('USR'),
    username,
    display_name: cleanString(body.displayName || body.display_name || username, 120),
    password_hash: await hashPassword(String(body.password)),
    role,
    status: cleanString(body.status || 'active', 20),
    session_version: 1,
    created_at: now,
    updated_at: now,
  };
  await insertUserSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, { action: 'createAccount', entityType: 'user', entityId: row.user_id, newJson: safeUser(row), actor }));
  return json({ ok: true, user: safeUser(row) });
}

async function updateAccount(request, env, ctx, actor) {
  const denied = requireRole(actor, ADMIN_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const role = cleanString(body.role, 20);
  const status = cleanString(body.status || 'active', 20);
  if (!body.userId || !['admin', 'manager', 'purchasing', 'viewer'].includes(role) || !['active', 'inactive', 'frozen', 'archived'].includes(status)) {
    return json({ ok: false, error: 'Thong tin tai khoan khong hop le' }, 400);
  }
  const now = nowIso();
  const row = {
    user_id: body.userId,
    display_name: cleanString(body.displayName || body.display_name, 120),
    role,
    status,
    bump_session: body.forceLogout ? 1 : 0,
    updated_at: now,
  };
  await updateUserSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, { action: 'updateAccount', entityType: 'user', entityId: row.user_id, newJson: row, actor }));
  return json({ ok: true });
}

async function changePassword(request, env, ctx, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  if (!actor?.id) return json({ ok: false, error: 'Chua dang nhap' }, 401);
  const body = await readJson(request);
  if (!body.newPassword || String(body.newPassword).length < 8) {
    return json({ ok: false, error: 'Mat khau moi toi thieu 8 ky tu' }, 400);
  }
  await updatePasswordSQL(env.DB, actor.id, await hashPassword(String(body.newPassword)), nowIso());
  ctx.waitUntil(writeActionLog(env, { action: 'changePassword', entityType: 'user', entityId: actor.id, actor }));
  return json({ ok: true });
}
