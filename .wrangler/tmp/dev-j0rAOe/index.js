var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker/db/account-queries.js
function parseCursor(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf("|||");
  return idx === -1 ? { pk: cursor, sortVal: void 0 } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}
__name(parseCursor, "parseCursor");
var ACCOUNT_SORT = {
  username: { col: "username", rowKey: "username", type: "text" },
  display_name: { col: "display_name", rowKey: "display_name", type: "text" },
  role: { col: "role", rowKey: "role", type: "text" },
  status: { col: "status", rowKey: "status", type: "text" }
};
async function getUserByUsernameSQL(db, username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
}
__name(getUserByUsernameSQL, "getUserByUsernameSQL");
async function listUsersSQL(db, { limit, cursor, sortBy, sortDir }) {
  const sort = ACCOUNT_SORT[sortBy] || null;
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const op = dir === "ASC" ? ">" : "<";
  const binds = [];
  const where = [];
  if (cursor) {
    const c = parseCursor(cursor);
    if (!sort || c.sortVal === void 0) {
      where.push("user_id > ?");
      binds.push(c.pk);
    } else {
      const wrap = `COALESCE(${sort.col}, '')`;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND user_id ${op} ?))`);
      binds.push(c.sortVal, c.sortVal, c.pk);
    }
  }
  const orderBy = sort ? `${sort.col} ${dir}, user_id ${dir}` : "user_id ASC";
  const res = await db.prepare(
    `SELECT user_id, username, display_name, role, status, session_version, created_at, updated_at
     FROM users ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = sort ? String(last[sort.rowKey] ?? "") + "|||" + last.user_id : last.user_id;
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor };
}
__name(listUsersSQL, "listUsersSQL");
async function insertUserSQL(db, row) {
  return db.prepare(
    `INSERT INTO users (user_id, username, display_name, password_hash, role, status, session_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.user_id, row.username, row.display_name, row.password_hash, row.role, row.status, row.session_version, row.created_at, row.updated_at).run();
}
__name(insertUserSQL, "insertUserSQL");
async function updateUserSQL(db, row) {
  return db.prepare(
    `UPDATE users SET display_name = ?, role = ?, status = ?, session_version = session_version + ?, updated_at = ?
     WHERE user_id = ?`
  ).bind(row.display_name, row.role, row.status, row.bump_session || 0, row.updated_at, row.user_id).run();
}
__name(updateUserSQL, "updateUserSQL");
async function updatePasswordSQL(db, userId, passwordHash, updatedAt) {
  return db.prepare(
    "UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE user_id = ?"
  ).bind(passwordHash, updatedAt, userId).run();
}
__name(updatePasswordSQL, "updatePasswordSQL");

// src/worker/db/system-queries.js
async function getActorSessionSQL(db, userId) {
  return db.prepare(
    "SELECT user_id, role, status, session_version FROM users WHERE user_id = ?"
  ).bind(userId).first();
}
__name(getActorSessionSQL, "getActorSessionSQL");
async function getLastEntityIdSQL(db, table, idCol, likePattern) {
  return db.prepare(
    `SELECT ${idCol} AS id FROM ${table} WHERE ${idCol} LIKE ? ORDER BY ${idCol} DESC LIMIT 1`
  ).bind(likePattern).first();
}
__name(getLastEntityIdSQL, "getLastEntityIdSQL");

// src/worker/lib/utils.js
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}
__name(json, "json");
async function readJson(request) {
  if (request.method === "GET") {
    const url = new URL(request.url);
    return Object.fromEntries(url.searchParams.entries());
  }
  return request.json().catch(() => ({}));
}
__name(readJson, "readJson");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function publicActorName(actor) {
  return actor?.displayName || actor?.username || actor?.id || "System";
}
__name(publicActorName, "publicActorName");
function clampLimit(value, fallback = 50, max = 200) {
  const n = Number(value || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}
__name(clampLimit, "clampLimit");
async function nextEntityId(db, table, idCol, prefix) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const row = await getLastEntityIdSQL(db, table, idCol, `${prefix}-${year}-%`);
  const last = row?.id ? Number(String(row.id).split("-").pop()) : 0;
  return `${prefix}-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(5, "0")}`;
}
__name(nextEntityId, "nextEntityId");
function makeId(prefix) {
  const rand = crypto.randomUUID().slice(0, 8).toUpperCase();
  return `${prefix}-${(/* @__PURE__ */ new Date()).getUTCFullYear()}-${rand}`;
}
__name(makeId, "makeId");

// src/worker/lib/auth.js
var ROLES = ["admin", "manager", "purchasing", "viewer"];
var ALL_ROLES = new Set(ROLES);
var WRITE_ROLES = /* @__PURE__ */ new Set(["admin", "manager", "purchasing"]);
var MANAGE_ROLES = /* @__PURE__ */ new Set(["admin", "manager"]);
var ADMIN_ROLES = /* @__PURE__ */ new Set(["admin"]);
var enc = new TextEncoder();
function validateSecret(request, env) {
  const expected = env?.WORKER_SECRET;
  if (!expected) return false;
  const fromHeader = request.headers.get("X-Worker-Secret");
  const fromBearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return fromHeader === expected || fromBearer === expected;
}
__name(validateSecret, "validateSecret");
function actorFromRequest(request) {
  const raw = request.headers.get("X-App-Actor");
  if (!raw) return null;
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
__name(actorFromRequest, "actorFromRequest");
async function validateActorSession(db, actor) {
  if (!actor?.id || !actor?.sessionVersion) return false;
  const row = await getActorSessionSQL(db, actor.id);
  return Boolean(
    row && row.status === "active" && row.role === actor.role && Number(row.session_version) === Number(actor.sessionVersion)
  );
}
__name(validateActorSession, "validateActorSession");
function requireRole(actor, allowed) {
  if (!actor?.role || !allowed.has(actor.role)) {
    return json({ ok: false, error: "Khong co quyen" }, 403);
  }
  return null;
}
__name(requireRole, "requireRole");
function safeUser(row) {
  if (!row) return null;
  return {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    sessionVersion: row.session_version
  };
}
__name(safeUser, "safeUser");
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
__name(b64, "b64");
function fromB64(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
__name(fromB64, "fromB64");
async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 1e5 },
    key,
    256
  );
  return `pbkdf2_sha256$100000$${b64(salt)}$${b64(bits)}`;
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("pbkdf2_sha256$")) return false;
  const [, iter, saltB64, hashB64] = stored.split("$");
  const salt = fromB64(saltB64);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: Number(iter) || 1e5 },
    key,
    256
  );
  const left = new Uint8Array(bits);
  const right = fromB64(hashB64);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}
__name(verifyPassword, "verifyPassword");

// src/worker/db/audit-queries.js
function parseCursor2(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf("|||");
  return idx === -1 ? { pk: cursor, sortVal: void 0 } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}
__name(parseCursor2, "parseCursor");
var AUDIT_SORT = {
  created_at: { col: "created_at", rowKey: "created_at", type: "text" },
  actor_name: { col: "actor_name", rowKey: "actor_name", type: "text" },
  action: { col: "action", rowKey: "action", type: "text" }
};
async function insertAuditLogSQL(db, row) {
  return db.prepare(
    `INSERT INTO audit_logs (audit_id, action, entity_type, entity_id, message, old_json, new_json, actor_id, actor_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.audit_id, row.action, row.entity_type, row.entity_id, row.message, row.old_json, row.new_json, row.actor_id, row.actor_name, row.created_at).run();
}
__name(insertAuditLogSQL, "insertAuditLogSQL");
async function listAuditLogsSQL(db, { q, cursor, sortBy, sortDir, limit }) {
  const sort = AUDIT_SORT[sortBy] || null;
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const op = dir === "ASC" ? ">" : "<";
  const binds = [];
  const where = [];
  if (q) {
    where.push("(message LIKE ? OR action LIKE ? OR entity_id LIKE ? OR actor_name LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (cursor) {
    const c = parseCursor2(cursor);
    if (!sort || c.sortVal === void 0) {
      where.push(`audit_id ${op} ?`);
      binds.push(c.pk);
    } else {
      const wrap = `COALESCE(${sort.col}, '')`;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND audit_id ${op} ?))`);
      binds.push(c.sortVal, c.sortVal, c.pk);
    }
  }
  const orderBy = sort ? `${sort.col} ${dir}, audit_id ${dir}` : "audit_id DESC";
  const res = await db.prepare(
    `SELECT * FROM audit_logs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = sort ? String(last[sort.rowKey] ?? "") + "|||" + last.audit_id : last.audit_id;
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor };
}
__name(listAuditLogsSQL, "listAuditLogsSQL");

// src/worker/lib/action-log.js
async function writeActionLog(env, opts = {}) {
  const actor = opts.actor || {};
  const row = {
    audit_id: makeId("AUDIT"),
    action: opts.action || "unknown",
    entity_type: opts.entityType || "",
    entity_id: opts.entityId || "",
    message: opts.message || `${publicActorName(actor)} thuc hien ${opts.action || "unknown"}`,
    old_json: opts.oldJson ? JSON.stringify(opts.oldJson) : "",
    new_json: opts.newJson ? JSON.stringify(opts.newJson) : "",
    actor_id: actor.id || "",
    actor_name: publicActorName(actor),
    created_at: nowIso()
  };
  await insertAuditLogSQL(env.DB, row);
  return row;
}
__name(writeActionLog, "writeActionLog");

// src/worker/lib/normalize.js
function normalizeText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/\s+/g, " ").trim();
}
__name(normalizeText, "normalizeText");
function buildSearchText(parts = []) {
  return normalizeText(parts.filter(Boolean).join(" "));
}
__name(buildSearchText, "buildSearchText");
function cleanString(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}
__name(cleanString, "cleanString");
function cleanMoney(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}
__name(cleanMoney, "cleanMoney");
function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
__name(cleanNumber, "cleanNumber");

// src/worker/handlers/accounts.js
async function handleAccounts(action, request, env, ctx, actor) {
  if (action === "authLogin") return authLogin(request, env);
  if (action === "initSetup") return initSetup(request, env);
  if (action === "logout") return json({ ok: true });
  if (action === "getSession") {
    const denied = requireRole(actor, ALL_ROLES);
    if (denied) return denied;
    return json({ ok: true, user: actor });
  }
  if (action === "changePassword") return changePassword(request, env, ctx, actor);
  if (action === "getAccounts") return listAccounts(request, env, actor);
  if (action === "createAccount") return createAccount(request, env, ctx, actor);
  if (action === "updateAccount") return updateAccount(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown account action" }, 400);
}
__name(handleAccounts, "handleAccounts");
async function initSetup(request, env) {
  const body = await readJson(request);
  if (!env.SETUP_SECRET || body.setupSecret !== env.SETUP_SECRET) {
    return json({ ok: false, error: "Setup secret khong hop le" }, 403);
  }
  const existing = await listUsersSQL(env.DB, { limit: 1, cursor: "" });
  if (existing.rows.length) return json({ ok: false, error: "Da co user, khong the init lai" }, 409);
  const username = cleanString(body.username || "admin", 80).toLowerCase();
  const password = String(body.password || "");
  if (!password || password.length < 8) return json({ ok: false, error: "Mat khau admin toi thieu 8 ky tu" }, 400);
  const now = nowIso();
  const row = {
    user_id: makeId("USR"),
    username,
    display_name: cleanString(body.displayName || "Admin", 120),
    password_hash: await hashPassword(password),
    role: "admin",
    status: "active",
    session_version: 1,
    created_at: now,
    updated_at: now
  };
  await insertUserSQL(env.DB, row);
  return json({ ok: true, user: safeUser(row) });
}
__name(initSetup, "initSetup");
async function authLogin(request, env) {
  const body = await readJson(request);
  const username = cleanString(body.username, 80).toLowerCase();
  const password = String(body.password || "");
  if (!username || !password) return json({ ok: false, error: "Thieu tai khoan hoac mat khau" }, 400);
  const row = await getUserByUsernameSQL(env.DB, username);
  if (!row || row.status !== "active") return json({ ok: false, error: "Tai khoan khong hop le" }, 401);
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return json({ ok: false, error: "Sai tai khoan hoac mat khau" }, 401);
  return json({ ok: true, user: safeUser(row) });
}
__name(authLogin, "authLogin");
async function listAccounts(request, env, actor) {
  const denied = requireRole(actor, ADMIN_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const data = await listUsersSQL(env.DB, { limit: clampLimit(body.limit), cursor: body.cursor || "", sortBy: body.sortBy || "", sortDir: body.sortDir || "" });
  return json({ ok: true, ...data });
}
__name(listAccounts, "listAccounts");
async function createAccount(request, env, ctx, actor) {
  const denied = requireRole(actor, ADMIN_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const username = cleanString(body.username, 80).toLowerCase();
  const role = cleanString(body.role, 20);
  if (!username || !body.password || !["admin", "manager", "purchasing", "viewer"].includes(role)) {
    return json({ ok: false, error: "Thong tin tai khoan khong hop le" }, 400);
  }
  const exists = await getUserByUsernameSQL(env.DB, username);
  if (exists) return json({ ok: false, error: "Username da ton tai" }, 409);
  const now = nowIso();
  const row = {
    user_id: makeId("USR"),
    username,
    display_name: cleanString(body.displayName || body.display_name || username, 120),
    password_hash: await hashPassword(String(body.password)),
    role,
    status: cleanString(body.status || "active", 20),
    session_version: 1,
    created_at: now,
    updated_at: now
  };
  await insertUserSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, { action: "createAccount", entityType: "user", entityId: row.user_id, newJson: safeUser(row), actor }));
  return json({ ok: true, user: safeUser(row) });
}
__name(createAccount, "createAccount");
async function updateAccount(request, env, ctx, actor) {
  const denied = requireRole(actor, ADMIN_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const role = cleanString(body.role, 20);
  const status = cleanString(body.status || "active", 20);
  if (!body.userId || !["admin", "manager", "purchasing", "viewer"].includes(role) || !["active", "inactive", "frozen", "archived"].includes(status)) {
    return json({ ok: false, error: "Thong tin tai khoan khong hop le" }, 400);
  }
  const now = nowIso();
  const row = {
    user_id: body.userId,
    display_name: cleanString(body.displayName || body.display_name, 120),
    role,
    status,
    bump_session: body.forceLogout ? 1 : 0,
    updated_at: now
  };
  await updateUserSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, { action: "updateAccount", entityType: "user", entityId: row.user_id, newJson: row, actor }));
  return json({ ok: true });
}
__name(updateAccount, "updateAccount");
async function changePassword(request, env, ctx, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  if (!actor?.id) return json({ ok: false, error: "Chua dang nhap" }, 401);
  const body = await readJson(request);
  if (!body.newPassword || String(body.newPassword).length < 8) {
    return json({ ok: false, error: "Mat khau moi toi thieu 8 ky tu" }, 400);
  }
  await updatePasswordSQL(env.DB, actor.id, await hashPassword(String(body.newPassword)), nowIso());
  ctx.waitUntil(writeActionLog(env, { action: "changePassword", entityType: "user", entityId: actor.id, actor }));
  return json({ ok: true });
}
__name(changePassword, "changePassword");

// src/worker/handlers/audit.js
async function handleAudit(action, request, env, ctx, actor) {
  if (action !== "getAuditLogs") return json({ ok: false, error: "Unknown audit action" }, 400);
  const denied = requireRole(actor, ADMIN_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const data = await listAuditLogsSQL(env.DB, { q: p.q || "", cursor: p.cursor || "", sortBy: p.sortBy || "", sortDir: p.sortDir || "", limit: clampLimit(p.limit) });
  return json({ ok: true, ...data });
}
__name(handleAudit, "handleAudit");

// src/worker/db/client-queries.js
function parseCursor3(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf("|||");
  return idx === -1 ? { pk: cursor, sortVal: void 0 } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}
__name(parseCursor3, "parseCursor");
var CLIENT_SORT = {
  client_id: { col: "c.client_id", rowKey: "client_id", type: "text" },
  client_name: { col: "c.client_name", rowKey: "client_name", type: "text" },
  legal_name: { col: "c.legal_name", rowKey: "legal_name", type: "text" },
  plant_name: { col: "c.plant_name", rowKey: "plant_name", type: "text" },
  province: { col: "c.province", rowKey: "province", type: "text" }
};
async function listClientsSQL(db, { q, cursor, sortBy, sortDir, limit }) {
  const sort = CLIENT_SORT[sortBy] || null;
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const op = dir === "ASC" ? ">" : "<";
  const binds = [];
  const where = ["c.deleted_at IS NULL"];
  if (q) {
    where.push("(c.normalized_search LIKE ? OR c.client_name LIKE ? OR c.client_id LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`, `${q}%`);
  }
  if (cursor) {
    const cur = parseCursor3(cursor);
    if (!sort || cur.sortVal === void 0) {
      where.push("c.client_id > ?");
      binds.push(cur.pk);
    } else {
      const wrap = `COALESCE(${sort.col}, '')`;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND c.client_id ${op} ?))`);
      binds.push(cur.sortVal, cur.sortVal, cur.pk);
    }
  }
  const orderBy = sort ? `${sort.col} ${dir}, c.client_id ${dir}` : "c.client_id ASC";
  const res = await db.prepare(
    `SELECT c.*,
       COALESCE(rs.rfq_total, 0)        AS rfq_total,
       COALESCE(rs.rfq_dang_khao_gia, 0) AS rfq_dang_khao_gia,
       COALESCE(rs.rfq_da_bao, 0)        AS rfq_da_bao,
       COALESCE(rs.rfq_trung, 0)         AS rfq_trung,
       COALESCE(rs.rfq_khong_trung, 0)   AS rfq_khong_trung,
       COALESCE(rs.rfq_treo, 0)          AS rfq_treo,
       COALESCE(rs.rfq_tham_khao, 0)     AS rfq_tham_khao
     FROM clients c
     LEFT JOIN (
       SELECT client_id,
         COUNT(*) AS rfq_total,
         SUM(CASE WHEN trang_thai_goi = 'dang_khao_gia' THEN 1 ELSE 0 END) AS rfq_dang_khao_gia,
         SUM(CASE WHEN trang_thai_goi = 'da_bao'        THEN 1 ELSE 0 END) AS rfq_da_bao,
         SUM(CASE WHEN trang_thai_goi = 'trung'         THEN 1 ELSE 0 END) AS rfq_trung,
         SUM(CASE WHEN trang_thai_goi = 'khong_trung'   THEN 1 ELSE 0 END) AS rfq_khong_trung,
         SUM(CASE WHEN trang_thai_goi = 'treo'          THEN 1 ELSE 0 END) AS rfq_treo,
         SUM(CASE WHEN trang_thai_goi = 'tham_khao'     THEN 1 ELSE 0 END) AS rfq_tham_khao
       FROM rfqs
       WHERE trang_thai_goi != 'archived' AND client_id IS NOT NULL AND client_id != ''
       GROUP BY client_id
     ) rs ON rs.client_id = c.client_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = sort ? String(last[sort.rowKey] ?? "") + "|||" + last.client_id : last.client_id;
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor };
}
__name(listClientsSQL, "listClientsSQL");
async function archiveClientSQL(db, clientId, now) {
  return db.prepare("UPDATE clients SET deleted_at = ? WHERE client_id = ?").bind(now, clientId).run();
}
__name(archiveClientSQL, "archiveClientSQL");
async function getClientSQL(db, id) {
  return db.prepare("SELECT * FROM clients WHERE client_id = ?").bind(id).first();
}
__name(getClientSQL, "getClientSQL");
async function insertClientSQL(db, row) {
  return db.prepare(
    `INSERT INTO clients (
      client_id, client_name, plant_name, province, note,
      tax_code, legal_name, client_type, address, email, phone, website,
      normalized_search, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.client_id,
    row.client_name,
    row.plant_name,
    row.province,
    row.note,
    row.tax_code,
    row.legal_name,
    row.client_type,
    row.address,
    row.email,
    row.phone,
    row.website,
    row.normalized_search,
    row.created_at,
    row.updated_at
  ).run();
}
__name(insertClientSQL, "insertClientSQL");
async function updateClientSQL(db, row) {
  return db.prepare(
    `UPDATE clients SET
      client_name=?, plant_name=?, province=?, note=?,
      tax_code=?, legal_name=?, client_type=?, address=?, email=?, phone=?, website=?,
      normalized_search=?, updated_at=?
     WHERE client_id=?`
  ).bind(
    row.client_name,
    row.plant_name,
    row.province,
    row.note,
    row.tax_code,
    row.legal_name,
    row.client_type,
    row.address,
    row.email,
    row.phone,
    row.website,
    row.normalized_search,
    row.updated_at,
    row.client_id
  ).run();
}
__name(updateClientSQL, "updateClientSQL");

// src/worker/handlers/clients.js
var VALID_CLIENT_TYPES = /* @__PURE__ */ new Set(["company", "individual", "other"]);
async function handleClients(action, request, env, ctx, actor, body) {
  if (action === "getClients") return listClients(request, env, actor, body);
  if (action === "createClient") return saveClient(request, env, ctx, actor, false, body);
  if (action === "updateClient") return saveClient(request, env, ctx, actor, true, body);
  if (action === "archiveClient") return archiveClient(request, env, ctx, actor, body);
  return json({ ok: false, error: "Unknown client action" }, 400);
}
__name(handleClients, "handleClients");
async function listClients(request, env, actor, body) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = body || await readJson(request);
  const data = await listClientsSQL(env.DB, { q: normalizeText(p.q), cursor: p.cursor || "", sortBy: p.sortBy || "", sortDir: p.sortDir || "", limit: clampLimit(p.limit) });
  return json({ ok: true, ...data });
}
__name(listClients, "listClients");
async function archiveClient(request, env, ctx, actor, body) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  body = body || await readJson(request);
  const clientId = cleanString(body.clientId || body.client_id, 80);
  if (!clientId) return json({ ok: false, error: "Thieu ma khach hang" }, 400);
  const row = await getClientSQL(env.DB, clientId);
  if (!row) return json({ ok: false, error: "Khong tim thay khach hang" }, 404);
  const now = nowIso();
  await archiveClientSQL(env.DB, clientId, now);
  ctx.waitUntil(writeActionLog(env, { action: "archiveClient", entityType: "client", entityId: clientId, oldJson: row, newJson: null, actor }));
  return json({ ok: true });
}
__name(archiveClient, "archiveClient");
async function saveClient(request, env, ctx, actor, isUpdate, body) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  body = body || await readJson(request);
  const name = cleanString(body.clientName || body.client_name, 180);
  if (!name) return json({ ok: false, error: "Ten CDT/khach hang la bat buoc" }, 400);
  const now = nowIso();
  const oldRow = isUpdate ? await getClientSQL(env.DB, body.clientId || body.client_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: "Khong tim thay client" }, 404);
  const cs = /* @__PURE__ */ __name((val, max) => cleanString(val, max), "cs");
  const plantName = cs(body.plantName || body.plant_name, 180);
  const province = cs(body.province, 80);
  const taxCode = cs(body.taxCode || body.tax_code, 50);
  const legalName = cs(body.legalName || body.legal_name, 250);
  const clientType = VALID_CLIENT_TYPES.has(body.clientType || body.client_type) ? body.clientType || body.client_type : "company";
  const address = cs(body.address, 500);
  const email = cs(body.email, 200);
  const phone = cs(body.phone, 50);
  const website = cs(body.website, 250);
  const note = cs(body.note, 1e3);
  const row = {
    client_id: isUpdate ? oldRow.client_id : await nextEntityId(env.DB, "clients", "client_id", "CL"),
    client_name: name,
    plant_name: plantName,
    province,
    note,
    tax_code: taxCode,
    legal_name: legalName,
    client_type: clientType,
    address,
    email,
    phone,
    website,
    normalized_search: buildSearchText([name, plantName, province, taxCode, legalName, address, email, phone]),
    created_at: oldRow?.created_at || now,
    updated_at: now
  };
  if (isUpdate) await updateClientSQL(env.DB, row);
  else await insertClientSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? "updateClient" : "createClient",
    entityType: "client",
    entityId: row.client_id,
    oldJson: oldRow,
    newJson: row,
    actor
  }));
  return json({ ok: true, client: row });
}
__name(saveClient, "saveClient");

// src/worker/db/client-equipment-queries.js
async function listClientEquipmentSQL(db, { clientId, q, limit }) {
  const binds = [clientId];
  let where = "client_id = ?";
  if (q) {
    where += " AND normalized_search LIKE ?";
    binds.push(`%${q}%`);
  }
  const lim = Math.min(Number(limit) || 200, 500);
  const res = await db.prepare(
    `SELECT * FROM client_equipment WHERE ${where} ORDER BY equipment_group ASC, equipment_name ASC LIMIT ?`
  ).bind(...binds, lim).all();
  return { rows: res.results || [] };
}
__name(listClientEquipmentSQL, "listClientEquipmentSQL");
async function getClientEquipmentSQL(db, id) {
  return db.prepare("SELECT * FROM client_equipment WHERE equipment_id = ?").bind(id).first();
}
__name(getClientEquipmentSQL, "getClientEquipmentSQL");
async function insertClientEquipmentSQL(db, row) {
  return db.prepare(
    `INSERT INTO client_equipment (
      equipment_id, client_id, plant_name, unit_no, system_area,
      equipment_group, equipment_name, equipment_tag,
      oem_manufacturer, oem_model, oem_spec, oem_part_no,
      replacement_manufacturer, replacement_model, replacement_spec, replacement_part_no,
      critical_level, status, note, normalized_search,
      created_by, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.equipment_id,
    row.client_id,
    row.plant_name,
    row.unit_no,
    row.system_area,
    row.equipment_group,
    row.equipment_name,
    row.equipment_tag,
    row.oem_manufacturer,
    row.oem_model,
    row.oem_spec,
    row.oem_part_no,
    row.replacement_manufacturer,
    row.replacement_model,
    row.replacement_spec,
    row.replacement_part_no,
    row.critical_level,
    row.status,
    row.note,
    row.normalized_search,
    row.created_by,
    row.created_at,
    row.updated_at
  ).run();
}
__name(insertClientEquipmentSQL, "insertClientEquipmentSQL");
async function updateClientEquipmentSQL(db, row) {
  return db.prepare(
    `UPDATE client_equipment SET
      plant_name=?, unit_no=?, system_area=?,
      equipment_group=?, equipment_name=?, equipment_tag=?,
      oem_manufacturer=?, oem_model=?, oem_spec=?, oem_part_no=?,
      replacement_manufacturer=?, replacement_model=?, replacement_spec=?, replacement_part_no=?,
      critical_level=?, status=?, note=?, normalized_search=?, updated_at=?
     WHERE equipment_id=?`
  ).bind(
    row.plant_name,
    row.unit_no,
    row.system_area,
    row.equipment_group,
    row.equipment_name,
    row.equipment_tag,
    row.oem_manufacturer,
    row.oem_model,
    row.oem_spec,
    row.oem_part_no,
    row.replacement_manufacturer,
    row.replacement_model,
    row.replacement_spec,
    row.replacement_part_no,
    row.critical_level,
    row.status,
    row.note,
    row.normalized_search,
    row.updated_at,
    row.equipment_id
  ).run();
}
__name(updateClientEquipmentSQL, "updateClientEquipmentSQL");
async function archiveClientEquipmentSQL(db, id, updatedAt) {
  return db.prepare(
    `UPDATE client_equipment SET status = 'archived', updated_at = ? WHERE equipment_id = ?`
  ).bind(updatedAt, id).run();
}
__name(archiveClientEquipmentSQL, "archiveClientEquipmentSQL");

// src/worker/handlers/client-equipment.js
var VALID_GROUPS = /* @__PURE__ */ new Set([
  "turbine",
  "generator",
  "boiler",
  "heater",
  "primary_fan",
  "secondary_fan",
  "coal_mill",
  "gearbox",
  "condenser",
  "feed_pump",
  "transformer",
  "pump",
  "motor",
  "valve",
  "other"
]);
async function handleClientEquipment(action, request, env, ctx, actor) {
  if (action === "getClientEquipment") return listEquipment(request, env, actor);
  if (action === "createClientEquipment") return saveEquipment(request, env, ctx, actor, false);
  if (action === "updateClientEquipment") return saveEquipment(request, env, ctx, actor, true);
  if (action === "archiveClientEquipment") return archiveEquipment(request, env, ctx, actor);
  if (action === "importClientEquipment") return importEquipment(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown equipment action" }, 400);
}
__name(handleClientEquipment, "handleClientEquipment");
async function listEquipment(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = request.method === "GET" ? Object.fromEntries(new URL(request.url).searchParams) : await readJson(request);
  if (!p.clientId) return json({ ok: false, error: "clientId la bat buoc" }, 400);
  const data = await listClientEquipmentSQL(env.DB, {
    clientId: p.clientId,
    q: p.q ? normalizeText(p.q) : null,
    limit: p.limit
  });
  return json({ ok: true, ...data });
}
__name(listEquipment, "listEquipment");
async function saveEquipment(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const group = cleanString(body.equipmentGroup || body.equipment_group, 50).toLowerCase();
  if (!VALID_GROUPS.has(group)) {
    return json({ ok: false, error: `equipment_group khong hop le. Hop le: ${[...VALID_GROUPS].join(", ")}` }, 400);
  }
  const clientId = cleanString(body.clientId || body.client_id, 50);
  if (!clientId) return json({ ok: false, error: "clientId la bat buoc" }, 400);
  const now = nowIso();
  const oldRow = isUpdate ? await getClientEquipmentSQL(env.DB, body.equipmentId || body.equipment_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: "Khong tim thay thiet bi" }, 404);
  const cs = /* @__PURE__ */ __name((val, max) => cleanString(val, max), "cs");
  const row = {
    equipment_id: isUpdate ? oldRow.equipment_id : makeId("EQ"),
    client_id: isUpdate ? oldRow.client_id : clientId,
    plant_name: cs(body.plantName || body.plant_name, 120),
    unit_no: cs(body.unitNo || body.unit_no, 80),
    system_area: cs(body.systemArea || body.system_area, 120),
    equipment_group: group,
    equipment_name: cs(body.equipmentName || body.equipment_name, 200),
    equipment_tag: cs(body.equipmentTag || body.equipment_tag, 80),
    oem_manufacturer: cs(body.oemManufacturer || body.oem_manufacturer, 150),
    oem_model: cs(body.oemModel || body.oem_model, 200),
    oem_spec: cs(body.oemSpec || body.oem_spec, 500),
    oem_part_no: cs(body.oemPartNo || body.oem_part_no, 150),
    replacement_manufacturer: cs(body.replacementManufacturer || body.replacement_manufacturer, 150),
    replacement_model: cs(body.replacementModel || body.replacement_model, 200),
    replacement_spec: cs(body.replacementSpec || body.replacement_spec, 500),
    replacement_part_no: cs(body.replacementPartNo || body.replacement_part_no, 150),
    critical_level: ["critical", "normal", "low"].includes(body.criticalLevel || body.critical_level) ? body.criticalLevel || body.critical_level : "normal",
    status: isUpdate ? oldRow.status || "active" : "active",
    note: cs(body.note, 1e3),
    normalized_search: buildSearchText([
      body.plantName || body.plant_name,
      body.unitNo || body.unit_no,
      group,
      body.equipmentName || body.equipment_name,
      body.equipmentTag || body.equipment_tag,
      body.oemManufacturer || body.oem_manufacturer,
      body.oemModel || body.oem_model,
      body.oemSpec || body.oem_spec,
      body.oemPartNo || body.oem_part_no,
      body.replacementManufacturer || body.replacement_manufacturer,
      body.replacementModel || body.replacement_model,
      body.replacementSpec || body.replacement_spec,
      body.replacementPartNo || body.replacement_part_no
    ]),
    created_by: isUpdate ? oldRow.created_by : actor?.id || "",
    created_at: isUpdate ? oldRow.created_at : now,
    updated_at: now
  };
  if (isUpdate) await updateClientEquipmentSQL(env.DB, row);
  else await insertClientEquipmentSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? "updateClientEquipment" : "createClientEquipment",
    entityType: "client_equipment",
    entityId: row.equipment_id,
    oldJson: oldRow,
    newJson: row,
    actor
  }));
  return json({ ok: true, equipment: row });
}
__name(saveEquipment, "saveEquipment");
async function archiveEquipment(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const id = cleanString(body.equipmentId || body.equipment_id, 50);
  if (!id) return json({ ok: false, error: "equipmentId la bat buoc" }, 400);
  const oldRow = await getClientEquipmentSQL(env.DB, id);
  if (!oldRow) return json({ ok: false, error: "Khong tim thay thiet bi" }, 404);
  const now = nowIso();
  await archiveClientEquipmentSQL(env.DB, id, now);
  ctx.waitUntil(writeActionLog(env, {
    action: "archiveClientEquipment",
    entityType: "client_equipment",
    entityId: id,
    oldJson: oldRow,
    newJson: { ...oldRow, status: "archived", updated_at: now },
    actor
  }));
  return json({ ok: true });
}
__name(archiveEquipment, "archiveEquipment");
async function importEquipment(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const clientId = cleanString(body.clientId || body.client_id, 50);
  if (!clientId) return json({ ok: false, error: "clientId la bat buoc" }, 400);
  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  if (!rawRows.length) return json({ ok: false, error: "Khong co du lieu de nhap" }, 400);
  if (rawRows.length > 500) return json({ ok: false, error: "Toi da 500 dong moi lan nhap" }, 400);
  const now = nowIso();
  const results = { created: 0, errors: [] };
  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const cs = /* @__PURE__ */ __name((val, max) => cleanString(val, max), "cs");
    const group = cs(r.equipment_group, 50).toLowerCase();
    if (!VALID_GROUPS.has(group)) {
      results.errors.push(`Dong ${i + 1}: equipment_group "${group}" khong hop le`);
      continue;
    }
    const row = {
      equipment_id: makeId("EQ"),
      client_id: clientId,
      plant_name: cs(r.plant_name, 120),
      unit_no: cs(r.unit_no, 80),
      system_area: cs(r.system_area, 120),
      equipment_group: group,
      equipment_name: cs(r.equipment_name, 200),
      equipment_tag: cs(r.equipment_tag, 80),
      oem_manufacturer: cs(r.oem_manufacturer, 150),
      oem_model: cs(r.oem_model, 200),
      oem_spec: cs(r.oem_spec, 500),
      oem_part_no: cs(r.oem_part_no, 150),
      replacement_manufacturer: cs(r.replacement_manufacturer, 150),
      replacement_model: cs(r.replacement_model, 200),
      replacement_spec: cs(r.replacement_spec, 500),
      replacement_part_no: cs(r.replacement_part_no, 150),
      critical_level: ["critical", "normal", "low"].includes(String(r.critical_level || "")) ? String(r.critical_level) : "normal",
      status: "active",
      note: cs(r.note, 1e3),
      normalized_search: buildSearchText([
        r.plant_name,
        r.unit_no,
        group,
        r.equipment_name,
        r.equipment_tag,
        r.oem_manufacturer,
        r.oem_model,
        r.oem_spec,
        r.oem_part_no,
        r.replacement_manufacturer,
        r.replacement_model,
        r.replacement_spec,
        r.replacement_part_no
      ]),
      created_by: actor?.id || "",
      created_at: now,
      updated_at: now
    };
    try {
      await insertClientEquipmentSQL(env.DB, row);
      results.created++;
    } catch (err) {
      results.errors.push(`Dong ${i + 1}: ${err.message || "loi khi luu"}`);
    }
  }
  if (results.created > 0) {
    ctx.waitUntil(writeActionLog(env, {
      action: "importClientEquipment",
      entityType: "client_equipment",
      entityId: clientId,
      newJson: { clientId, created: results.created },
      actor
    }));
  }
  return json({ ok: true, ...results });
}
__name(importEquipment, "importEquipment");

// src/worker/db/client-contact-queries.js
async function listClientContactsSQL(db, { clientId }) {
  const res = await db.prepare(
    `SELECT * FROM client_contacts WHERE client_id = ? ORDER BY is_primary DESC, contact_name ASC`
  ).bind(clientId).all();
  return { rows: res.results || [] };
}
__name(listClientContactsSQL, "listClientContactsSQL");
async function getClientContactSQL(db, id) {
  return db.prepare("SELECT * FROM client_contacts WHERE contact_id = ?").bind(id).first();
}
__name(getClientContactSQL, "getClientContactSQL");
async function clearPrimaryContactSQL(db, clientId) {
  return db.prepare("UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?").bind(clientId).run();
}
__name(clearPrimaryContactSQL, "clearPrimaryContactSQL");
async function insertClientContactSQL(db, row) {
  return db.prepare(
    `INSERT INTO client_contacts (
      contact_id, client_id, contact_name, department, position,
      role_type, specialty_tags, phone, email, zalo, note,
      is_primary, status, created_by, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.contact_id,
    row.client_id,
    row.contact_name,
    row.department,
    row.position,
    row.role_type,
    row.specialty_tags,
    row.phone,
    row.email,
    row.zalo,
    row.note,
    row.is_primary,
    row.status,
    row.created_by,
    row.created_at,
    row.updated_at
  ).run();
}
__name(insertClientContactSQL, "insertClientContactSQL");
async function updateClientContactSQL(db, row) {
  return db.prepare(
    `UPDATE client_contacts SET
      contact_name=?, department=?, position=?, role_type=?, specialty_tags=?,
      phone=?, email=?, zalo=?, note=?, is_primary=?, updated_at=?
     WHERE contact_id=?`
  ).bind(
    row.contact_name,
    row.department,
    row.position,
    row.role_type,
    row.specialty_tags,
    row.phone,
    row.email,
    row.zalo,
    row.note,
    row.is_primary,
    row.updated_at,
    row.contact_id
  ).run();
}
__name(updateClientContactSQL, "updateClientContactSQL");
async function archiveClientContactSQL(db, id, updatedAt) {
  return db.prepare(
    `UPDATE client_contacts SET status = 'archived', is_primary = 0, updated_at = ? WHERE contact_id = ?`
  ).bind(updatedAt, id).run();
}
__name(archiveClientContactSQL, "archiveClientContactSQL");

// src/worker/handlers/client-contacts.js
var VALID_ROLE_TYPES = /* @__PURE__ */ new Set([
  "technical",
  "procurement",
  "commercial",
  "finance",
  "safety",
  "production",
  "management",
  "other"
]);
async function handleClientContacts(action, request, env, ctx, actor) {
  if (action === "getClientContacts") return listContacts(request, env, actor);
  if (action === "createClientContact") return saveContact(request, env, ctx, actor, false);
  if (action === "updateClientContact") return saveContact(request, env, ctx, actor, true);
  if (action === "archiveClientContact") return archiveContact(request, env, ctx, actor);
  if (action === "importClientContacts") return importContacts(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown contact action" }, 400);
}
__name(handleClientContacts, "handleClientContacts");
async function listContacts(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  if (!p.clientId) return json({ ok: false, error: "clientId la bat buoc" }, 400);
  const data = await listClientContactsSQL(env.DB, { clientId: p.clientId });
  return json({ ok: true, ...data });
}
__name(listContacts, "listContacts");
async function saveContact(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const clientId = cleanString(body.clientId || body.client_id, 50);
  if (!clientId) return json({ ok: false, error: "clientId la bat buoc" }, 400);
  const contactName = cleanString(body.contactName || body.contact_name, 200);
  if (!contactName) return json({ ok: false, error: "contact_name la bat buoc" }, 400);
  const roleType = (body.roleType || body.role_type || "other").toLowerCase();
  if (!VALID_ROLE_TYPES.has(roleType)) return json({ ok: false, error: `role_type khong hop le` }, 400);
  const now = nowIso();
  const cs = /* @__PURE__ */ __name((val, max) => cleanString(val, max), "cs");
  const isPrimary = body.isPrimary === "1" || body.isPrimary === 1 || body.is_primary === 1 ? 1 : 0;
  const oldRow = isUpdate ? await getClientContactSQL(env.DB, body.contactId || body.contact_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: "Khong tim thay lien he" }, 404);
  if (isPrimary) await clearPrimaryContactSQL(env.DB, clientId);
  const row = {
    contact_id: isUpdate ? oldRow.contact_id : makeId("CC"),
    client_id: isUpdate ? oldRow.client_id : clientId,
    contact_name: contactName,
    department: cs(body.department, 150),
    position: cs(body.position, 150),
    role_type: roleType,
    specialty_tags: cs(body.specialtyTags || body.specialty_tags, 500),
    phone: cs(body.phone, 50),
    email: cs(body.email, 200),
    zalo: cs(body.zalo, 100),
    note: cs(body.note, 1e3),
    is_primary: isPrimary,
    status: isUpdate ? oldRow.status || "active" : "active",
    created_by: isUpdate ? oldRow.created_by : actor?.id || "",
    created_at: isUpdate ? oldRow.created_at : now,
    updated_at: now
  };
  if (isUpdate) await updateClientContactSQL(env.DB, row);
  else await insertClientContactSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? "updateClientContact" : "createClientContact",
    entityType: "client_contact",
    entityId: row.contact_id,
    oldJson: oldRow,
    newJson: row,
    actor
  }));
  return json({ ok: true, contact: row });
}
__name(saveContact, "saveContact");
async function archiveContact(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const id = cleanString(body.contactId || body.contact_id, 50);
  if (!id) return json({ ok: false, error: "contactId la bat buoc" }, 400);
  const oldRow = await getClientContactSQL(env.DB, id);
  if (!oldRow) return json({ ok: false, error: "Khong tim thay lien he" }, 404);
  const now = nowIso();
  await archiveClientContactSQL(env.DB, id, now);
  ctx.waitUntil(writeActionLog(env, {
    action: "archiveClientContact",
    entityType: "client_contact",
    entityId: id,
    oldJson: oldRow,
    newJson: { ...oldRow, status: "archived", updated_at: now },
    actor
  }));
  return json({ ok: true });
}
__name(archiveContact, "archiveContact");
async function importContacts(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const clientId = cleanString(body.clientId || body.client_id, 50);
  if (!clientId) return json({ ok: false, error: "clientId la bat buoc" }, 400);
  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  if (!rawRows.length) return json({ ok: false, error: "Khong co du lieu de nhap" }, 400);
  if (rawRows.length > 200) return json({ ok: false, error: "Toi da 200 dong moi lan nhap" }, 400);
  const now = nowIso();
  const results = { created: 0, errors: [] };
  const cs = /* @__PURE__ */ __name((val, max) => cleanString(val, max), "cs");
  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const contactName = cs(r.contact_name, 200);
    if (!contactName) {
      results.errors.push(`Dong ${i + 1}: contact_name trong`);
      continue;
    }
    const roleType = String(r.role_type || "other").trim().toLowerCase();
    if (!VALID_ROLE_TYPES.has(roleType)) {
      results.errors.push(`Dong ${i + 1}: role_type "${roleType}" khong hop le`);
      continue;
    }
    const row = {
      contact_id: makeId("CC"),
      client_id: clientId,
      contact_name: contactName,
      department: cs(r.department, 150),
      position: cs(r.position, 150),
      role_type: roleType,
      specialty_tags: cs(r.specialty_tags, 500),
      phone: cs(r.phone, 50),
      email: cs(r.email, 200),
      zalo: cs(r.zalo, 100),
      note: cs(r.note, 1e3),
      is_primary: 0,
      status: "active",
      created_by: actor?.id || "",
      created_at: now,
      updated_at: now
    };
    try {
      await insertClientContactSQL(env.DB, row);
      results.created++;
    } catch (err) {
      results.errors.push(`Dong ${i + 1}: ${err.message || "loi khi luu"}`);
    }
  }
  if (results.created > 0) {
    ctx.waitUntil(writeActionLog(env, {
      action: "importClientContacts",
      entityType: "client_contact",
      entityId: clientId,
      newJson: { clientId, created: results.created },
      actor
    }));
  }
  return json({ ok: true, ...results });
}
__name(importContacts, "importContacts");

// src/worker/db/client-bank-account-queries.js
async function listClientBankAccountsSQL(db, { clientId }) {
  const res = await db.prepare(
    `SELECT * FROM client_bank_accounts WHERE client_id = ? ORDER BY is_primary DESC, created_at ASC`
  ).bind(clientId).all();
  return { rows: res.results || [] };
}
__name(listClientBankAccountsSQL, "listClientBankAccountsSQL");
async function getClientBankAccountSQL(db, id) {
  return db.prepare("SELECT * FROM client_bank_accounts WHERE bank_account_id = ?").bind(id).first();
}
__name(getClientBankAccountSQL, "getClientBankAccountSQL");
async function clearPrimaryBankAccountSQL(db, clientId) {
  return db.prepare("UPDATE client_bank_accounts SET is_primary = 0 WHERE client_id = ?").bind(clientId).run();
}
__name(clearPrimaryBankAccountSQL, "clearPrimaryBankAccountSQL");
async function insertClientBankAccountSQL(db, row) {
  return db.prepare(
    `INSERT INTO client_bank_accounts (
      bank_account_id, client_id, account_name, bank_account, bank_name,
      branch_name, currency, is_primary, status, note, created_by, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.bank_account_id,
    row.client_id,
    row.account_name,
    row.bank_account,
    row.bank_name,
    row.branch_name,
    row.currency,
    row.is_primary,
    row.status,
    row.note,
    row.created_by,
    row.created_at,
    row.updated_at
  ).run();
}
__name(insertClientBankAccountSQL, "insertClientBankAccountSQL");
async function updateClientBankAccountSQL(db, row) {
  return db.prepare(
    `UPDATE client_bank_accounts SET
      account_name=?, bank_account=?, bank_name=?, branch_name=?,
      currency=?, is_primary=?, note=?, updated_at=?
     WHERE bank_account_id=?`
  ).bind(
    row.account_name,
    row.bank_account,
    row.bank_name,
    row.branch_name,
    row.currency,
    row.is_primary,
    row.note,
    row.updated_at,
    row.bank_account_id
  ).run();
}
__name(updateClientBankAccountSQL, "updateClientBankAccountSQL");
async function archiveClientBankAccountSQL(db, id, updatedAt) {
  return db.prepare(
    `UPDATE client_bank_accounts SET status = 'archived', is_primary = 0, updated_at = ? WHERE bank_account_id = ?`
  ).bind(updatedAt, id).run();
}
__name(archiveClientBankAccountSQL, "archiveClientBankAccountSQL");

// src/worker/handlers/client-bank-accounts.js
var VALID_CURRENCIES = /* @__PURE__ */ new Set(["VND", "USD", "EUR"]);
async function handleClientBankAccounts(action, request, env, ctx, actor) {
  if (action === "getClientBankAccounts") return listBankAccounts(request, env, actor);
  if (action === "createClientBankAccount") return saveBankAccount(request, env, ctx, actor, false);
  if (action === "updateClientBankAccount") return saveBankAccount(request, env, ctx, actor, true);
  if (action === "archiveClientBankAccount") return archiveBankAccount(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown bank account action" }, 400);
}
__name(handleClientBankAccounts, "handleClientBankAccounts");
async function listBankAccounts(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  if (!p.clientId) return json({ ok: false, error: "clientId la bat buoc" }, 400);
  const data = await listClientBankAccountsSQL(env.DB, { clientId: p.clientId });
  return json({ ok: true, ...data });
}
__name(listBankAccounts, "listBankAccounts");
async function saveBankAccount(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const clientId = cleanString(body.clientId || body.client_id, 50);
  if (!clientId) return json({ ok: false, error: "clientId la bat buoc" }, 400);
  const bankAccount = cleanString(body.bankAccount || body.bank_account, 100);
  if (!bankAccount) return json({ ok: false, error: "bank_account la bat buoc" }, 400);
  const bankName = cleanString(body.bankName || body.bank_name, 200);
  if (!bankName) return json({ ok: false, error: "bank_name la bat buoc" }, 400);
  const currency = (body.currency || "VND").toUpperCase();
  const now = nowIso();
  const cs = /* @__PURE__ */ __name((val, max) => cleanString(val, max), "cs");
  const isPrimary = body.isPrimary === "1" || body.isPrimary === 1 || body.is_primary === 1 ? 1 : 0;
  const oldRow = isUpdate ? await getClientBankAccountSQL(env.DB, body.bankAccountId || body.bank_account_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: "Khong tim thay tai khoan ngan hang" }, 404);
  if (isPrimary) await clearPrimaryBankAccountSQL(env.DB, clientId);
  const row = {
    bank_account_id: isUpdate ? oldRow.bank_account_id : makeId("BK"),
    client_id: isUpdate ? oldRow.client_id : clientId,
    account_name: cs(body.accountName || body.account_name, 200),
    bank_account: bankAccount,
    bank_name: bankName,
    branch_name: cs(body.branchName || body.branch_name, 200),
    currency: VALID_CURRENCIES.has(currency) ? currency : "VND",
    is_primary: isPrimary,
    status: isUpdate ? oldRow.status || "active" : "active",
    note: cs(body.note, 1e3),
    created_by: isUpdate ? oldRow.created_by : actor?.id || "",
    created_at: isUpdate ? oldRow.created_at : now,
    updated_at: now
  };
  if (isUpdate) await updateClientBankAccountSQL(env.DB, row);
  else await insertClientBankAccountSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? "updateClientBankAccount" : "createClientBankAccount",
    entityType: "client_bank_account",
    entityId: row.bank_account_id,
    oldJson: oldRow,
    newJson: row,
    actor
  }));
  return json({ ok: true, bankAccount: row });
}
__name(saveBankAccount, "saveBankAccount");
async function archiveBankAccount(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const id = cleanString(body.bankAccountId || body.bank_account_id, 50);
  if (!id) return json({ ok: false, error: "bankAccountId la bat buoc" }, 400);
  const oldRow = await getClientBankAccountSQL(env.DB, id);
  if (!oldRow) return json({ ok: false, error: "Khong tim thay tai khoan ngan hang" }, 404);
  const now = nowIso();
  await archiveClientBankAccountSQL(env.DB, id, now);
  ctx.waitUntil(writeActionLog(env, {
    action: "archiveClientBankAccount",
    entityType: "client_bank_account",
    entityId: id,
    oldJson: oldRow,
    newJson: { ...oldRow, status: "archived", updated_at: now },
    actor
  }));
  return json({ ok: true });
}
__name(archiveBankAccount, "archiveBankAccount");

// src/worker/db/client-legal-history-queries.js
async function listClientLegalHistorySQL(db, { clientId }) {
  const res = await db.prepare(
    `SELECT * FROM client_legal_history WHERE client_id = ? ORDER BY effective_date DESC, created_at DESC`
  ).bind(clientId).all();
  return { rows: res.results || [] };
}
__name(listClientLegalHistorySQL, "listClientLegalHistorySQL");
async function insertClientLegalHistorySQL(db, row) {
  return db.prepare(
    `INSERT INTO client_legal_history (
      legal_history_id, client_id, effective_date, legal_name, tax_code, address, note, created_by, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.legal_history_id,
    row.client_id,
    row.effective_date,
    row.legal_name,
    row.tax_code,
    row.address,
    row.note,
    row.created_by,
    row.created_at
  ).run();
}
__name(insertClientLegalHistorySQL, "insertClientLegalHistorySQL");

// src/worker/handlers/client-legal-history.js
async function handleClientLegalHistory(action, request, env, ctx, actor) {
  if (action === "getClientLegalHistory") return listHistory(request, env, actor);
  if (action === "addClientLegalHistory") return addHistory(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown legal history action" }, 400);
}
__name(handleClientLegalHistory, "handleClientLegalHistory");
async function listHistory(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  if (!p.clientId) return json({ ok: false, error: "clientId la bat buoc" }, 400);
  const data = await listClientLegalHistorySQL(env.DB, { clientId: p.clientId });
  return json({ ok: true, ...data });
}
__name(listHistory, "listHistory");
async function addHistory(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const clientId = cleanString(body.clientId || body.client_id, 50);
  if (!clientId) return json({ ok: false, error: "clientId la bat buoc" }, 400);
  const effectiveDate = cleanString(body.effectiveDate || body.effective_date, 20);
  if (!effectiveDate) return json({ ok: false, error: "effective_date la bat buoc" }, 400);
  const cs = /* @__PURE__ */ __name((val, max) => cleanString(val, max), "cs");
  const now = nowIso();
  const row = {
    legal_history_id: makeId("LH"),
    client_id: clientId,
    effective_date: effectiveDate,
    legal_name: cs(body.legalName || body.legal_name, 250),
    tax_code: cs(body.taxCode || body.tax_code, 50),
    address: cs(body.address, 500),
    note: cs(body.note, 1e3),
    created_by: actor?.id || "",
    created_at: now
  };
  await insertClientLegalHistorySQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: "addClientLegalHistory",
    entityType: "client_legal_history",
    entityId: row.legal_history_id,
    newJson: row,
    actor
  }));
  return json({ ok: true, record: row });
}
__name(addHistory, "addHistory");

// src/worker/db/rfq-contact-queries.js
async function listRfqContactsSQL(db, { rfqId }) {
  const res = await db.prepare(
    `SELECT rc.*, cc.contact_name, cc.position, cc.department, cc.role_type,
            cc.specialty_tags, cc.phone, cc.email, cc.zalo
     FROM rfq_contacts rc
     JOIN client_contacts cc ON rc.contact_id = cc.contact_id
     WHERE rc.rfq_id = ? AND rc.status = 'active'
     ORDER BY rc.created_at ASC`
  ).bind(rfqId).all();
  return { rows: res.results || [] };
}
__name(listRfqContactsSQL, "listRfqContactsSQL");
async function checkRfqContactExistsSQL(db, rfqId, contactId) {
  return db.prepare(
    `SELECT rfq_contact_id FROM rfq_contacts WHERE rfq_id = ? AND contact_id = ? AND status = 'active'`
  ).bind(rfqId, contactId).first();
}
__name(checkRfqContactExistsSQL, "checkRfqContactExistsSQL");
async function insertRfqContactSQL(db, row) {
  return db.prepare(
    `INSERT INTO rfq_contacts (rfq_contact_id, rfq_id, client_id, contact_id, support_role, note, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.rfq_contact_id,
    row.rfq_id,
    row.client_id,
    row.contact_id,
    row.support_role,
    row.note,
    row.status,
    row.created_by,
    row.created_at
  ).run();
}
__name(insertRfqContactSQL, "insertRfqContactSQL");
async function archiveRfqContactSQL(db, id) {
  return db.prepare(`UPDATE rfq_contacts SET status = 'archived' WHERE rfq_contact_id = ?`).bind(id).run();
}
__name(archiveRfqContactSQL, "archiveRfqContactSQL");

// src/worker/handlers/rfq-contacts.js
async function handleRfqContacts(action, request, env, ctx, actor) {
  if (action === "getRfqContacts") return listContacts2(request, env, actor);
  if (action === "addRfqContact") return addContact(request, env, ctx, actor);
  if (action === "archiveRfqContact") return archiveContact2(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown rfq contact action" }, 400);
}
__name(handleRfqContacts, "handleRfqContacts");
async function listContacts2(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  if (!p.rfqId) return json({ ok: false, error: "rfqId la bat buoc" }, 400);
  const data = await listRfqContactsSQL(env.DB, { rfqId: p.rfqId });
  return json({ ok: true, ...data });
}
__name(listContacts2, "listContacts");
async function addContact(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 50);
  const clientId = cleanString(body.clientId || body.client_id, 50);
  const contactId = cleanString(body.contactId || body.contact_id, 50);
  if (!rfqId || !contactId || !clientId) return json({ ok: false, error: "rfqId, clientId, contactId la bat buoc" }, 400);
  const exists = await checkRfqContactExistsSQL(env.DB, rfqId, contactId);
  if (exists) return json({ ok: false, error: "Lien he nay da co trong goi RFQ" }, 409);
  const now = nowIso();
  const row = {
    rfq_contact_id: makeId("RC"),
    rfq_id: rfqId,
    client_id: clientId,
    contact_id: contactId,
    support_role: cleanString(body.supportRole || body.support_role, 150),
    note: cleanString(body.note, 500),
    status: "active",
    created_by: actor?.id || "",
    created_at: now
  };
  await insertRfqContactSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: "addRfqContact",
    entityType: "rfq_contact",
    entityId: row.rfq_contact_id,
    newJson: row,
    actor
  }));
  return json({ ok: true, rfqContact: row });
}
__name(addContact, "addContact");
async function archiveContact2(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const id = cleanString(body.rfqContactId || body.rfq_contact_id, 50);
  if (!id) return json({ ok: false, error: "rfqContactId la bat buoc" }, 400);
  await archiveRfqContactSQL(env.DB, id);
  ctx.waitUntil(writeActionLog(env, {
    action: "archiveRfqContact",
    entityType: "rfq_contact",
    entityId: id,
    actor
  }));
  return json({ ok: true });
}
__name(archiveContact2, "archiveContact");

// src/worker/db/import-queries.js
async function listImportTemplatesSQL(db, { ownerKey }) {
  const binds = [];
  const where = ownerKey ? "WHERE owner_key = ?" : "";
  if (ownerKey) binds.push(ownerKey);
  const res = await db.prepare(
    `SELECT template_id, owner_key, template_name, description, mapping_json, created_by, created_at, updated_at
     FROM import_templates
     ${where}
     ORDER BY updated_at DESC, template_name ASC`
  ).bind(...binds).all();
  return res.results || [];
}
__name(listImportTemplatesSQL, "listImportTemplatesSQL");
async function getImportTemplateSQL(db, templateId) {
  return db.prepare(
    `SELECT template_id, owner_key, template_name, description, mapping_json, created_by, created_at, updated_at
     FROM import_templates
     WHERE template_id = ?`
  ).bind(templateId).first();
}
__name(getImportTemplateSQL, "getImportTemplateSQL");
async function insertImportTemplateSQL(db, row) {
  return db.prepare(
    `INSERT INTO import_templates (
      template_id, owner_key, template_name, description, mapping_json, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.template_id,
    row.owner_key,
    row.template_name,
    row.description,
    row.mapping_json,
    row.created_by,
    row.created_at,
    row.updated_at
  ).run();
}
__name(insertImportTemplateSQL, "insertImportTemplateSQL");
async function updateImportTemplateSQL(db, row) {
  return db.prepare(
    `UPDATE import_templates SET
      owner_key = ?, template_name = ?, description = ?, mapping_json = ?, updated_at = ?
     WHERE template_id = ?`
  ).bind(
    row.owner_key,
    row.template_name,
    row.description,
    row.mapping_json,
    row.updated_at,
    row.template_id
  ).run();
}
__name(updateImportTemplateSQL, "updateImportTemplateSQL");
async function insertImportJobSQL(db, row) {
  return db.prepare(
    `INSERT INTO import_jobs (
      job_id, owner_key, rfq_id, source_file_name, source_sheet_name, status, total_rows,
      created_count, updated_count, skipped_count, error_count, created_by, created_at, committed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.job_id,
    row.owner_key,
    row.rfq_id,
    row.source_file_name,
    row.source_sheet_name,
    row.status,
    row.total_rows,
    row.created_count,
    row.updated_count,
    row.skipped_count,
    row.error_count,
    row.created_by,
    row.created_at,
    row.committed_at
  ).run();
}
__name(insertImportJobSQL, "insertImportJobSQL");
async function getImportJobSQL(db, jobId) {
  return db.prepare(
    `SELECT job_id, owner_key, rfq_id, source_file_name, source_sheet_name, status, total_rows,
      created_count, updated_count, skipped_count, error_count, created_by, created_at, committed_at
     FROM import_jobs
     WHERE job_id = ?`
  ).bind(jobId).first();
}
__name(getImportJobSQL, "getImportJobSQL");
async function listImportJobRowsSQL(db, { jobId, limit }) {
  const res = await db.prepare(
    `SELECT job_row_id, job_id, source_row_number, raw_row_json, mapped_json, status, error_message,
      rfq_id, rfq_item_id, created_at
     FROM import_job_rows
     WHERE job_id = ?
     ORDER BY source_row_number ASC, job_row_id ASC
     LIMIT ?`
  ).bind(jobId, limit).all();
  return res.results || [];
}
__name(listImportJobRowsSQL, "listImportJobRowsSQL");
async function insertImportJobRowSQL(db, row) {
  return db.prepare(
    `INSERT INTO import_job_rows (
      job_row_id, job_id, source_row_number, raw_row_json, mapped_json, status, error_message,
      rfq_id, rfq_item_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.job_row_id,
    row.job_id,
    row.source_row_number,
    row.raw_row_json,
    row.mapped_json,
    row.status,
    row.error_message,
    row.rfq_id,
    row.rfq_item_id,
    row.created_at
  ).run();
}
__name(insertImportJobRowSQL, "insertImportJobRowSQL");
async function checkRfqImportSafetySQL(db, rfqId) {
  const row = await db.prepare(`
    SELECT
      r.trang_thai_goi AS rfqStatus,
      r.ma_goi_tbmt    AS rfqCode,
      r.ten_goi        AS rfqName,
      (SELECT COUNT(*) FROM rfq_items WHERE rfq_id = ?) AS totalItemCount,
      (SELECT COUNT(DISTINCT tc.rfq_item_id) FROM technical_clarifications tc
       INNER JOIN rfq_items i ON i.rfq_item_id = tc.rfq_item_id
       WHERE i.rfq_id = ? AND tc.deleted_at IS NULL) AS clarificationCount,
      (SELECT COUNT(DISTINCT sq.rfq_item_id) FROM supplier_quotes sq
       INNER JOIN rfq_items i ON i.rfq_item_id = sq.rfq_item_id
       WHERE i.rfq_id = ?) AS quoteCount,
      (SELECT COUNT(DISTINCT pd.rfq_item_id) FROM pricing_decisions pd
       INNER JOIN rfq_items i ON i.rfq_item_id = pd.rfq_item_id
       WHERE i.rfq_id = ?) AS pricingCount,
      (SELECT COUNT(DISTINCT ci.rfq_item_id) FROM contract_items ci
       INNER JOIN rfq_items i ON i.rfq_item_id = ci.rfq_item_id
       WHERE i.rfq_id = ?) AS contractCount
    FROM rfqs r WHERE r.rfq_id = ?
  `).bind(rfqId, rfqId, rfqId, rfqId, rfqId, rfqId).first();
  return row || { rfqStatus: "", rfqCode: "", rfqName: "", totalItemCount: 0, clarificationCount: 0, quoteCount: 0, pricingCount: 0, contractCount: 0 };
}
__name(checkRfqImportSafetySQL, "checkRfqImportSafetySQL");
async function listRfqItemsByRfqIdSQL(db, rfqId) {
  const res = await db.prepare(
    `SELECT rfq_item_id, rfq_id, stt_goc, source_row_number,
       ma_mua_sam, ma_vat_tu, ten_vat_tu, required_model, quantity, unit,
       manufacturer, brand, origin_country, manufacture_year, technical_params,
       vat_lieu, phu_tung_chuyen_dung, yeu_cau_ky_thuat_bo_sung,
       thue_suat, don_gia_truoc_thue, thanh_tien_sau_thue, gia_hop_dong, delivery_time, note
     FROM rfq_items
     WHERE rfq_id = ? AND trang_thai_dong != 'archived'
     ORDER BY COALESCE(source_row_number, 0) ASC, rfq_item_id ASC`
  ).bind(rfqId).all();
  return res.results || [];
}
__name(listRfqItemsByRfqIdSQL, "listRfqItemsByRfqIdSQL");

// src/worker/db/rfq-queries.js
function parseCursor4(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf("|||");
  return idx === -1 ? { pk: cursor, sortVal: void 0 } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}
__name(parseCursor4, "parseCursor");
var RFQ_SORT = {
  rfq_id: { col: "r.rfq_id", rowKey: "rfq_id", type: "text" },
  ma_goi: { col: "r.ma_goi_tbmt", rowKey: "ma_goi_tbmt", type: "text" },
  ten_goi: { col: "r.ten_goi", rowKey: "ten_goi", type: "text" },
  client_name: { col: "c.client_name", rowKey: "client_name", type: "text" },
  ngay_dang_tai: { col: "r.ngay_nhan_hoac_dang_tai", rowKey: "ngay_nhan_hoac_dang_tai", type: "text" },
  han_nop: { col: "r.ngay_het_han", rowKey: "ngay_het_han", type: "text" },
  du_toan: { col: "r.du_toan", rowKey: "du_toan", type: "num" },
  trang_thai: { col: "r.trang_thai_goi", rowKey: "trang_thai_goi", type: "text" }
};
async function listRfqsSQL(db, { q, status, cursor, sortBy, sortDir, limit }) {
  const sort = RFQ_SORT[sortBy] || null;
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const op = dir === "ASC" ? ">" : "<";
  const binds = [];
  const where = [];
  if (q) {
    where.push("(r.normalized_search LIKE ? OR r.ten_goi LIKE ? OR r.ma_goi_tbmt LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push("r.trang_thai_goi = ?");
    binds.push(status);
  } else {
    where.push("r.trang_thai_goi != 'archived'");
  }
  if (cursor) {
    const c = parseCursor4(cursor);
    if (!sort || c.sortVal === void 0) {
      where.push(`r.rfq_id ${op} ?`);
      binds.push(c.pk);
    } else {
      const wrap = sort.type === "num" ? `COALESCE(${sort.col}, 0)` : `COALESCE(${sort.col}, '')`;
      const sv = sort.type === "num" ? Number(c.sortVal) : c.sortVal;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND r.rfq_id ${op} ?))`);
      binds.push(sv, sv, c.pk);
    }
  }
  const orderBy = sort ? `${sort.col} ${dir}, r.rfq_id ${dir}` : `r.rfq_id ${dir}`;
  const res = await db.prepare(
    `SELECT r.*, c.client_name,
       (SELECT COUNT(*) FROM rfq_items i WHERE i.rfq_id = r.rfq_id) AS item_count
     FROM rfqs r LEFT JOIN clients c ON c.client_id = r.client_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = sort ? String(last[sort.rowKey] ?? "") + "|||" + last.rfq_id : last.rfq_id;
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor };
}
__name(listRfqsSQL, "listRfqsSQL");
async function getRfqSQL(db, id) {
  return db.prepare("SELECT * FROM rfqs WHERE rfq_id = ?").bind(id).first();
}
__name(getRfqSQL, "getRfqSQL");
async function insertRfqSQL(db, row) {
  return db.prepare(
    `INSERT INTO rfqs (rfq_id, client_id, ma_goi_tbmt, ten_goi, nha_may_cdt, ngay_nhan_hoac_dang_tai, ngay_het_han,
       du_toan, trang_thai_goi, source_file_id, note, normalized_search, created_by, created_at, updated_at, external_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.rfq_id, row.client_id, row.ma_goi_tbmt, row.ten_goi, row.nha_may_cdt, row.ngay_nhan_hoac_dang_tai, row.ngay_het_han, row.du_toan, row.trang_thai_goi, row.source_file_id, row.note, row.normalized_search, row.created_by, row.created_at, row.updated_at, row.external_url || null).run();
}
__name(insertRfqSQL, "insertRfqSQL");
async function updateRfqSQL(db, row) {
  return db.prepare(
    `UPDATE rfqs SET client_id = ?, ma_goi_tbmt = ?, ten_goi = ?, nha_may_cdt = ?, ngay_nhan_hoac_dang_tai = ?,
       ngay_het_han = ?, du_toan = ?, trang_thai_goi = ?, source_file_id = ?, note = ?, normalized_search = ?, updated_at = ?,
       external_url = ?
     WHERE rfq_id = ?`
  ).bind(row.client_id, row.ma_goi_tbmt, row.ten_goi, row.nha_may_cdt, row.ngay_nhan_hoac_dang_tai, row.ngay_het_han, row.du_toan, row.trang_thai_goi, row.source_file_id, row.note, row.normalized_search, row.updated_at, row.external_url || null, row.rfq_id).run();
}
__name(updateRfqSQL, "updateRfqSQL");
async function archiveRfqSQL(db, rfqId, now) {
  return db.prepare("UPDATE rfqs SET trang_thai_goi = 'archived', updated_at = ? WHERE rfq_id = ?").bind(now, rfqId).run();
}
__name(archiveRfqSQL, "archiveRfqSQL");
async function quickUpdateRfqStatusSQL(db, rfqId, status, now) {
  return db.prepare(
    "UPDATE rfqs SET trang_thai_goi = ?, updated_at = ? WHERE rfq_id = ?"
  ).bind(status, now, rfqId).run();
}
__name(quickUpdateRfqStatusSQL, "quickUpdateRfqStatusSQL");
async function getRfqDeadlineReportSQL(db, today, d7) {
  const [overdueRow, dueSoonRow, samplesRes] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS n FROM rfqs
       WHERE trang_thai_goi IN ('dang_khao_gia','treo')
         AND ngay_het_han IS NOT NULL AND ngay_het_han != ''
         AND ngay_het_han < ?`
    ).bind(today).first(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM rfqs
       WHERE trang_thai_goi IN ('dang_khao_gia','treo')
         AND ngay_het_han IS NOT NULL AND ngay_het_han != ''
         AND ngay_het_han >= ? AND ngay_het_han <= ?`
    ).bind(today, d7).first(),
    db.prepare(
      `SELECT rfq_id, ma_goi_tbmt, ten_goi, ngay_het_han, trang_thai_goi
       FROM rfqs
       WHERE trang_thai_goi IN ('dang_khao_gia','treo')
         AND ngay_het_han IS NOT NULL AND ngay_het_han != ''
         AND ngay_het_han < ?
       ORDER BY ngay_het_han ASC LIMIT 10`
    ).bind(today).all()
  ]);
  return {
    overdue_count: overdueRow?.n || 0,
    due_soon_count: dueSoonRow?.n || 0,
    samples: samplesRes.results || []
  };
}
__name(getRfqDeadlineReportSQL, "getRfqDeadlineReportSQL");
async function getDashboardSQL(db) {
  const rfqs = await db.prepare("SELECT COUNT(*) AS total FROM rfqs").bind().first();
  const items = await db.prepare("SELECT COUNT(*) AS total FROM rfq_items").bind().first();
  const suppliers = await db.prepare("SELECT COUNT(*) AS total FROM suppliers").bind().first();
  const open = await db.prepare("SELECT COUNT(*) AS total FROM rfqs WHERE trang_thai_goi IN ('dang_khao_gia','treo')").bind().first();
  return { rfqs: rfqs?.total || 0, items: items?.total || 0, suppliers: suppliers?.total || 0, openRfqs: open?.total || 0 };
}
__name(getDashboardSQL, "getDashboardSQL");

// src/worker/db/rfq-item-queries.js
function parseCursor5(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf("|||");
  return idx === -1 ? { pk: cursor, sortVal: void 0 } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}
__name(parseCursor5, "parseCursor");
function addDaysYmd(dateStr, days) {
  const d = /* @__PURE__ */ new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
__name(addDaysYmd, "addDaysYmd");
function todayYmdVN(date = /* @__PURE__ */ new Date()) {
  const vn = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const y = vn.getFullYear();
  const m = String(vn.getMonth() + 1).padStart(2, "0");
  const d = String(vn.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
__name(todayYmdVN, "todayYmdVN");
var ITEM_SORT = {
  stt: { col: "i.stt_goc", rowKey: "stt_goc", type: "text" },
  ten_goi: { col: "r.ten_goi", rowKey: "ten_goi", type: "text" },
  ma_goi_tbmt: { col: "r.ma_goi_tbmt", rowKey: "ma_goi_tbmt", type: "text" },
  ma_mua_sam: { col: "i.ma_mua_sam", rowKey: "ma_mua_sam", type: "text" },
  ma_vat_tu: { col: "i.ma_vat_tu", rowKey: "ma_vat_tu", type: "text" },
  ten_vat_tu: { col: "i.ten_vat_tu", rowKey: "ten_vat_tu", type: "text" },
  required_model: { col: "i.required_model", rowKey: "required_model", type: "text" },
  brand: { col: "i.brand", rowKey: "brand", type: "text" },
  manufacture_year: { col: "i.manufacture_year", rowKey: "manufacture_year", type: "text" },
  origin_country: { col: "i.origin_country", rowKey: "origin_country", type: "text" },
  manufacturer: { col: "i.manufacturer", rowKey: "manufacturer", type: "text" },
  technical_params: { col: "i.technical_params", rowKey: "technical_params", type: "text" },
  vat_lieu: { col: "i.vat_lieu", rowKey: "vat_lieu", type: "text" },
  phu_tung_chuyen_dung: { col: "i.phu_tung_chuyen_dung", rowKey: "phu_tung_chuyen_dung", type: "text" },
  yeu_cau_ky_thuat_bo_sung: { col: "i.yeu_cau_ky_thuat_bo_sung", rowKey: "yeu_cau_ky_thuat_bo_sung", type: "text" },
  unit: { col: "i.unit", rowKey: "unit", type: "text" },
  quantity: { col: "i.quantity", rowKey: "quantity", type: "num" },
  thue_suat: { col: "i.thue_suat", rowKey: "thue_suat", type: "num" },
  don_gia_sau_thue: { col: "i.don_gia_sau_thue", rowKey: "don_gia_sau_thue", type: "num" },
  thanh_tien_sau_thue: { col: "i.thanh_tien_sau_thue", rowKey: "thanh_tien_sau_thue", type: "num" },
  gia_hop_dong: { col: "i.gia_hop_dong", rowKey: "gia_hop_dong", type: "num" },
  delivery_time: { col: "i.delivery_time", rowKey: "delivery_time", type: "text" },
  note: { col: "i.note", rowKey: "note", type: "text" },
  quy_cach_final: { col: "i.quy_cach_final", rowKey: "quy_cach_final", type: "text" },
  hang_final: { col: "i.hang_final", rowKey: "hang_final", type: "text" },
  xuat_xu_final: { col: "i.xuat_xu_final", rowKey: "xuat_xu_final", type: "text" },
  ghi_chu_final: { col: "i.ghi_chu_final", rowKey: "ghi_chu_final", type: "text" },
  trang_thai: { col: "i.trang_thai_dong", rowKey: "trang_thai_dong", type: "text" }
};
async function listRfqItemsSQL(db, { q, q2, q3, rfqId, status, techFilter, cursor, sortBy, sortDir, limit }) {
  const sort = ITEM_SORT[sortBy] || null;
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const op = dir === "ASC" ? ">" : "<";
  const today = todayYmdVN();
  const due7 = addDaysYmd(today, 7);
  const due15 = addDaysYmd(today, 15);
  const due30 = addDaysYmd(today, 30);
  const remainingExpr = `CASE
           WHEN COALESCE(ct.contract_quantity_total, 0) - COALESCE(dt.delivered_quantity_total, 0) > 0
           THEN COALESCE(ct.contract_quantity_total, 0) - COALESCE(dt.delivered_quantity_total, 0)
           ELSE 0
         END`;
  const binds = [];
  const where = [];
  if (q) {
    where.push("(i.normalized_search LIKE ? OR EXISTS (SELECT 1 FROM rfqs r2 WHERE r2.rfq_id = i.rfq_id AND (r2.ten_goi LIKE ? OR r2.ma_goi_tbmt LIKE ?)))");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (q2) {
    where.push("i.normalized_search LIKE ?");
    binds.push(`%${q2}%`);
  }
  if (q3) {
    where.push("i.normalized_search LIKE ?");
    binds.push(`%${q3}%`);
  }
  if (rfqId) {
    where.push("i.rfq_id = ?");
    binds.push(rfqId);
  }
  if (status) {
    where.push("i.trang_thai_dong = ?");
    binds.push(status);
  } else {
    where.push("i.trang_thai_dong != 'archived'");
  }
  if (techFilter === "has_clarification") {
    where.push("EXISTS (SELECT 1 FROM technical_clarifications tc WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL)");
  } else if (techFilter === "no_clarification") {
    where.push("NOT EXISTS (SELECT 1 FROM technical_clarifications tc WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL)");
  } else if (techFilter === "khong_can") {
    where.push("i.trang_thai_ky_thuat = 'khong_can_xac_nhan'");
  } else if (techFilter === "dang_hoi") {
    where.push("i.trang_thai_ky_thuat IN ('dang_hoi','can_bo_sung','processing','waiting_supplier','waiting_client','need_more_info')");
  } else if (techFilter === "da_xac_nhan") {
    where.push("i.trang_thai_ky_thuat IN ('da_xac_nhan','final_confirmed')");
  } else if (techFilter === "bi_tu_choi") {
    where.push("i.trang_thai_ky_thuat IN ('bi_tu_choi','rejected','thay_the')");
  }
  const baseWhere = [...where];
  const baseBinds = [...binds];
  if (cursor) {
    const c = parseCursor5(cursor);
    if (!sort) {
      if (c.sortVal === void 0) {
        where.push(`i.rfq_item_id > ?`);
        binds.push(c.pk);
      } else {
        where.push(`(COALESCE(i.source_row_number, 0) > ? OR (COALESCE(i.source_row_number, 0) = ? AND i.rfq_item_id > ?))`);
        binds.push(Number(c.sortVal), Number(c.sortVal), c.pk);
      }
    } else if (c.sortVal === void 0) {
      where.push(`i.rfq_item_id ${op} ?`);
      binds.push(c.pk);
    } else {
      const wrap = `COALESCE(${sort.col}, '')`;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND i.rfq_item_id ${op} ?))`);
      binds.push(c.sortVal, c.sortVal, c.pk);
    }
  }
  const innerOrderBy = sort ? `${sort.col} ${dir}, i.rfq_item_id ${dir}` : `COALESCE(i.source_row_number, 0) ASC, i.rfq_item_id ASC`;
  const outerOrderBy = sort ? `${sort.col.replace(/^\w+\./, "")} ${dir}, rfq_item_id ${dir}` : `COALESCE(source_row_number, 0) ASC, rfq_item_id ASC`;
  const countSql = `SELECT COUNT(*) AS total FROM rfq_items i${baseWhere.length ? ` WHERE ${baseWhere.join(" AND ")}` : ""}`;
  const [countRow, res] = await Promise.all([
    cursor ? Promise.resolve(null) : db.prepare(countSql).bind(...baseBinds).first(),
    db.prepare(
      `WITH page AS (
         SELECT i.*, r.ten_goi, r.ma_goi_tbmt, COALESCE(c.client_name, r.nha_may_cdt, '') AS ten_cdt
         FROM rfq_items i LEFT JOIN rfqs r ON r.rfq_id = i.rfq_id LEFT JOIN clients c ON c.client_id = r.client_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY ${innerOrderBy} LIMIT ?
       ),
       tc_latest AS (
         SELECT
           tc.rfq_item_id,
           tc.title,
           tc.status_after,
           COUNT(*) OVER (PARTITION BY tc.rfq_item_id) AS clarification_count,
           ROW_NUMBER() OVER (PARTITION BY tc.rfq_item_id ORDER BY tc.created_at DESC, tc.sequence_no DESC) AS rn
         FROM technical_clarifications tc
         WHERE tc.deleted_at IS NULL
           AND tc.rfq_item_id IN (SELECT rfq_item_id FROM page)
       ),
       contract_totals AS (
         SELECT
           ci.rfq_item_id,
           COALESCE(SUM(ci.contract_quantity), 0) AS contract_quantity_total
         FROM contract_items ci
         WHERE ci.status = 'active'
           AND ci.rfq_item_id IN (SELECT rfq_item_id FROM page)
         GROUP BY ci.rfq_item_id
       ),
       delivery_totals AS (
         SELECT
           dni.rfq_item_id,
           COALESCE(SUM(dni.delivered_quantity), 0) AS delivered_quantity_total
         FROM delivery_note_items dni
         JOIN delivery_notes dn ON dn.delivery_note_id = dni.delivery_note_id
         WHERE dni.status = 'active'
           AND dn.status = 'active'
           AND dni.rfq_item_id IN (SELECT rfq_item_id FROM page)
         GROUP BY dni.rfq_item_id
       ),
       deadline_summary AS (
         SELECT
           ci.rfq_item_id,
           MIN(ci.delivery_deadline_date) AS delivery_deadline_date
         FROM contract_items ci
         WHERE ci.status = 'active'
           AND ci.delivery_deadline_date IS NOT NULL
           AND ci.delivery_deadline_date != ''
           AND ci.rfq_item_id IN (SELECT rfq_item_id FROM page)
         GROUP BY ci.rfq_item_id
       ),
       acceptance_totals AS (
         SELECT
           dni.rfq_item_id,
           COALESCE(SUM(CASE WHEN dni.acceptance_status = 'accepted' THEN dni.accepted_quantity ELSE 0 END), 0) AS accepted_quantity_total,
           MIN(CASE WHEN dni.warranty_end_date IS NOT NULL AND dni.warranty_end_date != '' THEN dni.warranty_end_date END) AS earliest_warranty_end
         FROM delivery_note_items dni
         JOIN delivery_notes dn ON dn.delivery_note_id = dni.delivery_note_id
         WHERE dni.status = 'active'
           AND dn.status = 'active'
           AND dni.rfq_item_id IN (SELECT rfq_item_id FROM page)
         GROUP BY dni.rfq_item_id
       )
       SELECT page.*,
         COALESCE(ltc.clarification_count, 0) AS clarification_count,
         ltc.status_after AS clarification_status,
         ltc.title AS latest_clarification_title,
         COALESCE(ct.contract_quantity_total, 0) AS contract_quantity_total,
         COALESCE(dt.delivered_quantity_total, 0) AS delivered_quantity_total,
         ${remainingExpr} AS remaining_quantity,
         ds.delivery_deadline_date AS delivery_deadline_date,
         CASE
           WHEN ds.delivery_deadline_date IS NOT NULL AND ds.delivery_deadline_date != ''
           THEN CAST(julianday(ds.delivery_deadline_date) - julianday(?) AS INTEGER)
           ELSE NULL
         END AS delivery_deadline_days_left,
         CASE
           WHEN ${remainingExpr} <= 0 THEN 'delivered_done'
           WHEN ds.delivery_deadline_date IS NULL OR ds.delivery_deadline_date = '' THEN 'no_deadline'
           WHEN ds.delivery_deadline_date < ? THEN 'overdue'
           WHEN ds.delivery_deadline_date <= ? THEN 'due_7'
           WHEN ds.delivery_deadline_date <= ? THEN 'due_15'
           WHEN ds.delivery_deadline_date <= ? THEN 'due_30'
           ELSE 'future'
         END AS delivery_deadline_status,
         (SELECT COUNT(*) FROM supplier_quotes sq WHERE sq.rfq_item_id = page.rfq_item_id AND sq.status != 'archived') AS quote_count,
         (SELECT MIN(sq.price_vnd_incl_tax) FROM supplier_quotes sq WHERE sq.rfq_item_id = page.rfq_item_id AND sq.status != 'archived' AND sq.price_vnd_incl_tax > 0) AS min_price_vnd_incl_tax,
         (SELECT JSON_GROUP_ARRAY(JSON_OBJECT('p', sub.p, 'n', sub.n)) FROM (SELECT sq.price_vnd_incl_tax AS p, COALESCE(sq.supplier_name,'') AS n FROM supplier_quotes sq WHERE sq.rfq_item_id = page.rfq_item_id AND sq.status != 'archived' AND sq.price_vnd_incl_tax > 0 ORDER BY sq.price_vnd_incl_tax ASC LIMIT 6) sub) AS quote_prices_json,
         COALESCE(at.accepted_quantity_total, 0) AS accepted_quantity_total,
         CASE
           WHEN COALESCE(dt.delivered_quantity_total, 0) - COALESCE(at.accepted_quantity_total, 0) > 0
           THEN COALESCE(dt.delivered_quantity_total, 0) - COALESCE(at.accepted_quantity_total, 0)
           ELSE 0
         END AS pending_acceptance_quantity,
         at.earliest_warranty_end AS warranty_end_date,
         CASE
           WHEN at.earliest_warranty_end IS NULL OR at.earliest_warranty_end = '' THEN 'no_warranty'
           WHEN at.earliest_warranty_end < ? THEN 'expired'
           WHEN at.earliest_warranty_end <= ? THEN 'expiring_30'
           ELSE 'active'
         END AS warranty_status,
         (SELECT COUNT(*) FROM media_files mf WHERE mf.owner_type = 'rfq_item' AND mf.owner_id = page.rfq_item_id AND mf.file_kind = 'item_image') AS image_count,
         (SELECT COUNT(*) FROM media_files mf WHERE mf.owner_type = 'rfq_item' AND mf.owner_id = page.rfq_item_id AND mf.file_kind = 'document_pdf') AS file_count
       FROM page
       LEFT JOIN tc_latest ltc ON ltc.rfq_item_id = page.rfq_item_id AND ltc.rn = 1
       LEFT JOIN contract_totals ct ON ct.rfq_item_id = page.rfq_item_id
       LEFT JOIN delivery_totals dt ON dt.rfq_item_id = page.rfq_item_id
       LEFT JOIN deadline_summary ds ON ds.rfq_item_id = page.rfq_item_id
       LEFT JOIN acceptance_totals at ON at.rfq_item_id = page.rfq_item_id
       ORDER BY ${outerOrderBy}`
    ).bind(...binds, limit + 1, today, today, due7, due15, due30, today, due30).all()
  ]);
  const totalCount = cursor ? null : Number(countRow?.total ?? 0);
  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    if (sort) {
      nextCursor = String(last[sort.rowKey] ?? "") + "|||" + last.rfq_item_id;
    } else {
      nextCursor = String(last.source_row_number ?? 0) + "|||" + last.rfq_item_id;
    }
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor, totalCount };
}
__name(listRfqItemsSQL, "listRfqItemsSQL");
async function archiveRfqItemSQL(db, rfqItemId, now) {
  return db.prepare("UPDATE rfq_items SET trang_thai_dong = 'archived', updated_at = ? WHERE rfq_item_id = ?").bind(now, rfqItemId).run();
}
__name(archiveRfqItemSQL, "archiveRfqItemSQL");
async function getRfqItemSQL(db, id) {
  return db.prepare("SELECT * FROM rfq_items WHERE rfq_item_id = ?").bind(id).first();
}
__name(getRfqItemSQL, "getRfqItemSQL");
async function insertRfqItemSQL(db, row) {
  return db.prepare(
    `INSERT INTO rfq_items (
      rfq_item_id, rfq_id, stt_goc, id_import_goc, ma_mua_sam, ma_vat_tu, ten_vat_tu,
      required_model, brand, manufacture_year, origin_country, manufacturer, technical_params, unit, quantity,
      origin_full_text, delivery_time, note,
      quy_cach_model_yeu_cau, hang_goc_nsx_goc, hang_bao_gia_nsx_bao_gia, nhan_hieu, xuat_xu, nam_san_xuat,
      vat_lieu, phu_tung_chuyen_dung, thong_so_ky_thuat, yeu_cau_ky_thuat_bo_sung, so_luong, don_vi,
      thue_suat, don_gia_truoc_thue, don_gia_sau_thue, thanh_tien_sau_thue, gia_hop_dong, nguon_gia,
      trang_thai_dong, trang_thai_ky_thuat, quy_cach_final, hang_final, xuat_xu_final, ghi_chu_final,
      item_id, normalized_search, raw_row_json, source_file_id, source_sheet_name, source_row_number,
      external_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.rfq_item_id,
    row.rfq_id,
    row.stt_goc,
    row.id_import_goc,
    row.ma_mua_sam,
    row.ma_vat_tu,
    row.ten_vat_tu,
    row.required_model,
    row.brand,
    row.manufacture_year,
    row.origin_country,
    row.manufacturer,
    row.technical_params,
    row.unit,
    row.quantity,
    row.origin_full_text,
    row.delivery_time,
    row.note,
    row.quy_cach_model_yeu_cau,
    row.hang_goc_nsx_goc,
    row.hang_bao_gia_nsx_bao_gia,
    row.nhan_hieu,
    row.xuat_xu,
    row.nam_san_xuat,
    row.vat_lieu,
    row.phu_tung_chuyen_dung,
    row.thong_so_ky_thuat,
    row.yeu_cau_ky_thuat_bo_sung,
    row.so_luong,
    row.don_vi,
    row.thue_suat,
    row.don_gia_truoc_thue,
    row.don_gia_sau_thue,
    row.thanh_tien_sau_thue,
    row.gia_hop_dong || 0,
    row.nguon_gia,
    row.trang_thai_dong,
    row.trang_thai_ky_thuat,
    row.quy_cach_final,
    row.hang_final,
    row.xuat_xu_final,
    row.ghi_chu_final,
    row.item_id,
    row.normalized_search,
    row.raw_row_json,
    row.source_file_id,
    row.source_sheet_name,
    row.source_row_number,
    row.external_url || null,
    row.created_at,
    row.updated_at
  ).run();
}
__name(insertRfqItemSQL, "insertRfqItemSQL");
async function updateRfqItemSQL(db, row) {
  return db.prepare(
    `UPDATE rfq_items SET
      rfq_id = ?, stt_goc = ?, id_import_goc = ?, ma_mua_sam = ?, ma_vat_tu = ?, ten_vat_tu = ?,
      required_model = ?, brand = ?, manufacture_year = ?, origin_country = ?, manufacturer = ?, technical_params = ?, unit = ?, quantity = ?,
      origin_full_text = ?, delivery_time = ?, note = ?,
      quy_cach_model_yeu_cau = ?, hang_goc_nsx_goc = ?, hang_bao_gia_nsx_bao_gia = ?, nhan_hieu = ?, xuat_xu = ?, nam_san_xuat = ?,
      vat_lieu = ?, phu_tung_chuyen_dung = ?, thong_so_ky_thuat = ?, yeu_cau_ky_thuat_bo_sung = ?, so_luong = ?, don_vi = ?,
      thue_suat = ?, don_gia_truoc_thue = ?, don_gia_sau_thue = ?, thanh_tien_sau_thue = ?, gia_hop_dong = ?, nguon_gia = ?,
      trang_thai_dong = ?, trang_thai_ky_thuat = ?, quy_cach_final = ?, hang_final = ?, xuat_xu_final = ?, ghi_chu_final = ?,
      item_id = ?, normalized_search = ?, raw_row_json = ?, source_file_id = ?, source_sheet_name = ?, source_row_number = ?,
      external_url = ?, updated_at = ?
     WHERE rfq_item_id = ?`
  ).bind(
    row.rfq_id,
    row.stt_goc,
    row.id_import_goc,
    row.ma_mua_sam,
    row.ma_vat_tu,
    row.ten_vat_tu,
    row.required_model,
    row.brand,
    row.manufacture_year,
    row.origin_country,
    row.manufacturer,
    row.technical_params,
    row.unit,
    row.quantity,
    row.origin_full_text,
    row.delivery_time,
    row.note,
    row.quy_cach_model_yeu_cau,
    row.hang_goc_nsx_goc,
    row.hang_bao_gia_nsx_bao_gia,
    row.nhan_hieu,
    row.xuat_xu,
    row.nam_san_xuat,
    row.vat_lieu,
    row.phu_tung_chuyen_dung,
    row.thong_so_ky_thuat,
    row.yeu_cau_ky_thuat_bo_sung,
    row.so_luong,
    row.don_vi,
    row.thue_suat,
    row.don_gia_truoc_thue,
    row.don_gia_sau_thue,
    row.thanh_tien_sau_thue,
    row.gia_hop_dong || 0,
    row.nguon_gia,
    row.trang_thai_dong,
    row.trang_thai_ky_thuat,
    row.quy_cach_final,
    row.hang_final,
    row.xuat_xu_final,
    row.ghi_chu_final,
    row.item_id,
    row.normalized_search,
    row.raw_row_json,
    row.source_file_id,
    row.source_sheet_name,
    row.source_row_number,
    row.external_url || null,
    row.updated_at,
    row.rfq_item_id
  ).run();
}
__name(updateRfqItemSQL, "updateRfqItemSQL");
async function exportRfqItemsSQL(db, { q, q2, q3, rfqId, status, techFilter, sortBy, sortDir, selectedIds }) {
  const sort = ITEM_SORT[sortBy] || null;
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const binds = [];
  const where = [];
  if (q) {
    where.push("(i.normalized_search LIKE ? OR EXISTS (SELECT 1 FROM rfqs r2 WHERE r2.rfq_id = i.rfq_id AND (r2.ten_goi LIKE ? OR r2.ma_goi_tbmt LIKE ?)))");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (q2) {
    where.push("i.normalized_search LIKE ?");
    binds.push(`%${q2}%`);
  }
  if (q3) {
    where.push("i.normalized_search LIKE ?");
    binds.push(`%${q3}%`);
  }
  if (rfqId) {
    where.push("i.rfq_id = ?");
    binds.push(rfqId);
  }
  if (status) {
    where.push("i.trang_thai_dong = ?");
    binds.push(status);
  } else {
    where.push("i.trang_thai_dong != 'archived'");
  }
  if (techFilter === "has_clarification") {
    where.push("EXISTS (SELECT 1 FROM technical_clarifications tc WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL)");
  } else if (techFilter === "no_clarification") {
    where.push("NOT EXISTS (SELECT 1 FROM technical_clarifications tc WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL)");
  } else if (techFilter === "khong_can") {
    where.push("i.trang_thai_ky_thuat = 'khong_can_xac_nhan'");
  } else if (techFilter === "dang_hoi") {
    where.push("i.trang_thai_ky_thuat IN ('dang_hoi','can_bo_sung','processing','waiting_supplier','waiting_client','need_more_info')");
  } else if (techFilter === "da_xac_nhan") {
    where.push("i.trang_thai_ky_thuat IN ('da_xac_nhan','final_confirmed')");
  } else if (techFilter === "bi_tu_choi") {
    where.push("i.trang_thai_ky_thuat IN ('bi_tu_choi','rejected','thay_the')");
  }
  if (Array.isArray(selectedIds) && selectedIds.length) {
    where.push(`i.rfq_item_id IN (${selectedIds.map(() => "?").join(",")})`);
    binds.push(...selectedIds);
  }
  const orderBy = sort ? `${sort.col} ${dir}, i.rfq_item_id ${dir}` : `COALESCE(i.source_row_number, 0) ASC, i.rfq_item_id ASC`;
  const res = await db.prepare(
    `SELECT i.*, r.ten_goi, r.ma_goi_tbmt, COALESCE(c.client_name, r.nha_may_cdt, '') AS ten_cdt,
     (SELECT tc.title FROM technical_clarifications tc WHERE tc.rfq_item_id = i.rfq_item_id AND tc.deleted_at IS NULL ORDER BY tc.created_at DESC, tc.sequence_no DESC LIMIT 1) AS latest_clarification_title
     FROM rfq_items i LEFT JOIN rfqs r ON r.rfq_id = i.rfq_id LEFT JOIN clients c ON c.client_id = r.client_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${orderBy} LIMIT 5000`
  ).bind(...binds).all();
  return res.results || [];
}
__name(exportRfqItemsSQL, "exportRfqItemsSQL");

// src/worker/lib/cache.js
var DEFAULT_TTL = 60 * 60 * 6;
async function getKv(env, key) {
  try {
    const raw = await env.KV?.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
__name(getKv, "getKv");
async function setKv(env, key, value, ttl = DEFAULT_TTL) {
  try {
    await env.KV?.put(key, JSON.stringify(value), { expirationTtl: ttl });
    return true;
  } catch {
    return false;
  }
}
__name(setKv, "setKv");
async function invalidateKv(env, keys = []) {
  await Promise.all(
    [keys].flat().filter(Boolean).map((key) => env.KV?.delete(key).catch(() => null))
  );
}
__name(invalidateKv, "invalidateKv");

// src/worker/handlers/imports.js
var TARGET_FIELDS = /* @__PURE__ */ new Set([
  "rfq_item_id",
  "ten_vat_tu",
  "stt_goc",
  "ma_mua_sam",
  "ma_vat_tu",
  "required_model",
  "manufacturer",
  "brand",
  "manufacture_year",
  "origin_country",
  "technical_params",
  "unit",
  "quantity",
  "vat_lieu",
  "phu_tung_chuyen_dung",
  "yeu_cau_ky_thuat_bo_sung",
  "thue_suat",
  "don_gia_truoc_thue",
  "don_gia_sau_thue",
  "thanh_tien_sau_thue",
  "gia_hop_dong",
  "note",
  "delivery_time",
  "origin_full_text",
  // Final clarification fields — importable when user explicitly ticks the overwrite checkbox
  "quy_cach_final",
  "hang_final",
  "xuat_xu_final",
  "ghi_chu_final"
]);
var TEXT_FIELDS = [
  "stt_goc",
  "ma_mua_sam",
  "ma_vat_tu",
  "ten_vat_tu",
  "required_model",
  "manufacturer",
  "brand",
  "manufacture_year",
  "origin_country",
  "technical_params",
  "unit",
  "vat_lieu",
  "phu_tung_chuyen_dung",
  "yeu_cau_ky_thuat_bo_sung",
  "note",
  "delivery_time",
  "origin_full_text",
  "quy_cach_final",
  "hang_final",
  "xuat_xu_final",
  "ghi_chu_final"
];
function normKey(s) {
  return String(s == null ? "" : s).replace(/　/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
__name(normKey, "normKey");
function buildImportKey(rfqId, sttGoc, maMuaSam, maVatTu) {
  return [String(rfqId || ""), normKey(sttGoc), normKey(maMuaSam), normKey(maVatTu)].join("\0");
}
__name(buildImportKey, "buildImportKey");
var COMPARE_FIELDS = [
  "ma_mua_sam",
  "ma_vat_tu",
  "ten_vat_tu",
  "required_model",
  "quantity",
  "unit",
  "manufacturer",
  "brand",
  "origin_country",
  "manufacture_year",
  "technical_params",
  "vat_lieu",
  "phu_tung_chuyen_dung",
  "yeu_cau_ky_thuat_bo_sung",
  "thue_suat",
  "don_gia_truoc_thue",
  "thanh_tien_sau_thue",
  "gia_hop_dong",
  "delivery_time",
  "note"
];
function hasContentChanged(existingRow, mapped) {
  for (const field of COMPARE_FIELDS) {
    const oldVal = existingRow[field] == null ? "" : String(existingRow[field]);
    const newVal = mapped[field] == null ? "" : String(mapped[field]);
    if (newVal !== "" && oldVal !== newVal) return true;
  }
  return false;
}
__name(hasContentChanged, "hasContentChanged");
function getChangedFields(existingRow, mapped) {
  const out = [];
  for (const field of COMPARE_FIELDS) {
    const oldVal = existingRow[field] == null ? "" : String(existingRow[field]);
    const newVal = mapped[field] == null ? "" : String(mapped[field]);
    if (newVal !== "" && oldVal !== newVal) out.push(field);
  }
  return out;
}
__name(getChangedFields, "getChangedFields");
function buildExistingKeyMap(rfqId, items) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items) {
    const stt = item.stt_goc || String(item.source_row_number || "0");
    const key = buildImportKey(rfqId, stt, item.ma_mua_sam, item.ma_vat_tu);
    if (!map.has(key)) map.set(key, item);
  }
  return map;
}
__name(buildExistingKeyMap, "buildExistingKeyMap");
async function handleImports(action, request, env, ctx, actor) {
  if (action === "getImportTemplates") return getTemplates(request, env, actor);
  if (action === "saveImportTemplate") return saveTemplate(request, env, actor);
  if (action === "checkRfqImportSafety") return checkSafety(request, env, actor);
  if (action === "previewImportRows") return previewRows(request, env, actor);
  if (action === "commitImportRows") return commitRows(request, env, ctx, actor);
  if (action === "getImportJob") return getJob(request, env, actor);
  if (action === "getImportJobRows") return getJobRows(request, env, actor);
  return json({ ok: false, error: "Unknown import action" }, 400);
}
__name(handleImports, "handleImports");
async function checkSafety(request, env, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 80);
  if (!rfqId) return json({ ok: false, error: "Thieu rfqId" }, 400);
  const counts = await checkRfqImportSafetySQL(env.DB, rfqId);
  return json({ ok: true, counts });
}
__name(checkSafety, "checkSafety");
async function getTemplates(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const ownerKey = cleanString(body.ownerKey || body.owner_key, 120);
  const rows = await listImportTemplatesSQL(env.DB, { ownerKey });
  return json({ ok: true, rows: rows.map(parseTemplateRow) });
}
__name(getTemplates, "getTemplates");
async function saveTemplate(request, env, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const ownerKey = cleanString(body.ownerKey || body.owner_key, 120);
  const templateName = cleanString(body.templateName || body.template_name, 160);
  const description = cleanString(body.description, 500);
  const templateId = cleanString(body.templateId || body.template_id, 80);
  const mapping = normalizeMapping(body.mappingJson ?? body.mapping_json);
  if (!ownerKey || !templateName) return json({ ok: false, error: "ownerKey va templateName la bat buoc" }, 400);
  if (!Object.keys(mapping).length) return json({ ok: false, error: "Mapping khong hop le" }, 400);
  const now = nowIso();
  const oldRow = templateId ? await getImportTemplateSQL(env.DB, templateId) : null;
  const row = {
    template_id: oldRow ? oldRow.template_id : makeId("IMPTPL"),
    owner_key: ownerKey,
    template_name: templateName,
    description,
    mapping_json: JSON.stringify(mapping),
    created_by: oldRow?.created_by || actor.id,
    created_at: oldRow?.created_at || now,
    updated_at: now
  };
  if (oldRow) await updateImportTemplateSQL(env.DB, row);
  else await insertImportTemplateSQL(env.DB, row);
  return json({ ok: true, template: parseTemplateRow(row) });
}
__name(saveTemplate, "saveTemplate");
async function commitRows(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 80);
  const rfq = rfqId ? await getRfqSQL(env.DB, rfqId) : null;
  if (!rfq) return json({ ok: false, error: "RFQ khong ton tai" }, 400);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
  if (!rows.length) return json({ ok: false, error: "Khong co dong import" }, 400);
  const importMode = ["update_changed", "skip_all_existing", "force_insert", "selective_update", "clear_and_reimport"].includes(body.importMode) ? body.importMode : "update_changed";
  const rawOverwriteFields = Array.isArray(body.overwriteFields) ? body.overwriteFields : [];
  const overwriteFields = rawOverwriteFields.map((f) => cleanString(f, 80)).filter((f) => TARGET_FIELDS.has(f));
  const clearBeforeImport = !!body.clearBeforeImport && importMode === "clear_and_reimport";
  const sourceSheetName = cleanString(body.sourceSheetName || body.source_sheet_name, 80) || "csv";
  const now = nowIso();
  const jobId = makeId("IMPJOB");
  const summary = { jobId, totalRows: rows.length, created: 0, updated: 0, skipped: 0, skippedUnmatched: 0, errors: 0, rowErrors: [] };
  const existingByKey = /* @__PURE__ */ new Map();
  if (importMode !== "force_insert" && importMode !== "clear_and_reimport") {
    const existing = await listRfqItemsByRfqIdSQL(env.DB, rfqId);
    for (const item of existing) {
      const stt = item.stt_goc || String(item.source_row_number || "0");
      const key = buildImportKey(rfqId, stt, item.ma_mua_sam, item.ma_vat_tu);
      if (!existingByKey.has(key)) existingByKey.set(key, item);
    }
  }
  if (clearBeforeImport) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM technical_clarifications WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
      env.DB.prepare(`DELETE FROM supplier_quotes WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
      env.DB.prepare(`DELETE FROM pricing_decisions WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
      env.DB.prepare(`DELETE FROM contract_items WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
      env.DB.prepare(`DELETE FROM rfq_item_revisions WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
      env.DB.prepare(`UPDATE import_job_rows SET rfq_item_id = NULL WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
      env.DB.prepare(`DELETE FROM rfq_items WHERE rfq_id = ?`).bind(rfqId)
    ]);
  }
  for (let i = 0; i < rows.length; i++) {
    const sourceRow = rows[i] || {};
    const sourceRowNumber = positiveInt(sourceRow.sourceRowNumber ?? sourceRow.source_row_number) || i + 2;
    const rawRow = objectOnly(sourceRow.rawRow ?? sourceRow.raw_row);
    const mapped = sanitizeMapped(sourceRow.mapped || {});
    let status = "created";
    let errorMessage = "";
    let rfqItemId = "";
    try {
      if (!mapped.ten_vat_tu) {
        status = "error";
        errorMessage = "Thieu ten_vat_tu";
        summary.errors++;
      } else {
        let oldRow = null;
        const explicitId = cleanString(mapped.rfq_item_id, 80);
        if (explicitId) {
          oldRow = await getRfqItemSQL(env.DB, explicitId);
          if (!oldRow) throw new Error(`Khong tim thay rfq_item_id ${explicitId}`);
          if (oldRow.rfq_id !== rfqId) throw new Error(`rfq_item_id ${explicitId} khong thuoc RFQ dang import`);
        } else if (importMode !== "force_insert" && importMode !== "clear_and_reimport") {
          const stt = cleanString(mapped.stt_goc, 40) || String(sourceRowNumber - 1);
          const key = buildImportKey(rfqId, stt, mapped.ma_mua_sam, mapped.ma_vat_tu);
          oldRow = existingByKey.get(key) ?? null;
        }
        if (oldRow && importMode === "skip_all_existing") {
          status = "skipped";
          rfqItemId = oldRow.rfq_item_id;
        } else if (oldRow && importMode === "update_changed" && !hasContentChanged(oldRow, mapped)) {
          status = "skipped";
          rfqItemId = oldRow.rfq_item_id;
        } else if (oldRow) {
          const itemRow = await buildImportItemRow(env.DB, { rfqId, mapped, oldRow, rawRow, sourceRowNumber, sourceSheetName, now, overwriteFields: importMode === "selective_update" ? overwriteFields : [] });
          await updateRfqItemSQL(env.DB, itemRow);
          status = "updated";
          summary.updated++;
          rfqItemId = itemRow.rfq_item_id;
        } else if (importMode === "selective_update") {
          status = "skipped";
          summary.skippedUnmatched++;
        } else {
          const itemRow = await buildImportItemRow(env.DB, { rfqId, mapped, oldRow: null, rawRow, sourceRowNumber, sourceSheetName, now, overwriteFields: [] });
          await insertRfqItemSQL(env.DB, itemRow);
          status = "created";
          summary.created++;
          rfqItemId = itemRow.rfq_item_id;
        }
      }
    } catch (err) {
      status = "error";
      errorMessage = err.message || String(err);
      summary.errors++;
    }
    if (status === "error") summary.rowErrors.push({ sourceRowNumber, error: errorMessage });
    await insertImportJobRowSQL(env.DB, {
      job_row_id: makeId("IMPROW"),
      job_id: jobId,
      source_row_number: sourceRowNumber,
      raw_row_json: JSON.stringify(rawRow),
      mapped_json: JSON.stringify(mapped),
      status,
      error_message: errorMessage,
      rfq_id: rfqId,
      rfq_item_id: rfqItemId,
      created_at: now
    });
  }
  summary.skipped = rows.length - summary.created - summary.updated - summary.errors;
  await insertImportJobSQL(env.DB, {
    job_id: jobId,
    owner_key: cleanString(body.ownerKey || body.owner_key, 120),
    rfq_id: rfqId,
    source_file_name: cleanString(body.sourceFileName || body.source_file_name, 180),
    source_sheet_name: sourceSheetName,
    status: summary.errors ? "completed_with_errors" : "completed",
    total_rows: rows.length,
    created_count: summary.created,
    updated_count: summary.updated,
    skipped_count: summary.skipped,
    error_count: summary.errors,
    created_by: actor.id,
    created_at: now,
    committed_at: now
  });
  ctx.waitUntil(invalidateKv(env, ["dashboard:v1", "dashboard:v2"]));
  const importParts = [`t\u1EA1o ${summary.created}`, `c\u1EADp nh\u1EADt ${summary.updated}`, `b\u1ECF qua ${summary.skipped}`];
  if (summary.errors) importParts.push(`l\u1ED7i ${summary.errors}`);
  ctx.waitUntil(writeActionLog(env, {
    action: "commitImportRows",
    entityType: "import_job",
    entityId: jobId,
    message: `Import d\xF2ng v\u1EADt t\u01B0 v\xE0o g\xF3i "${rfq.ten_goi}" (${rfqId}): ${importParts.join(", ")}`,
    newJson: summary,
    actor
  }));
  return json({ ok: true, summary });
}
__name(commitRows, "commitRows");
async function previewRows(request, env, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 80);
  const rfq = rfqId ? await getRfqSQL(env.DB, rfqId) : null;
  if (!rfq) return json({ ok: false, error: "RFQ khong ton tai" }, 400);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
  const existing = await listRfqItemsByRfqIdSQL(env.DB, rfqId);
  const existingByKey = buildExistingKeyMap(rfqId, existing);
  const previewItems = [];
  const summary = { total: rows.length, new: 0, exact_duplicate: 0, changed_same_key: 0, weak_key: 0 };
  for (let i = 0; i < rows.length; i++) {
    const sr = rows[i] || {};
    const srcRow = positiveInt(sr.sourceRowNumber ?? sr.source_row_number) || i + 2;
    const mapped = sanitizeMapped(sr.mapped || {});
    const stt = cleanString(mapped.stt_goc, 40) || String(srcRow - 1);
    const isWeak = !stt && !mapped.ma_vat_tu && !mapped.ten_vat_tu;
    if (isWeak) {
      summary.weak_key++;
      previewItems.push({ sourceRowNumber: srcRow, status: "weak_key" });
      continue;
    }
    const key = buildImportKey(rfqId, stt, mapped.ma_mua_sam, mapped.ma_vat_tu);
    const existingItem = existingByKey.get(key) ?? null;
    if (!existingItem) {
      summary.new++;
      previewItems.push({ sourceRowNumber: srcRow, status: "new", stt, ten_vat_tu: mapped.ten_vat_tu || "", ma_vat_tu: mapped.ma_vat_tu || "" });
    } else {
      const changedFields = getChangedFields(existingItem, mapped);
      if (!changedFields.length) {
        summary.exact_duplicate++;
        previewItems.push({ sourceRowNumber: srcRow, status: "exact_duplicate", stt, ten_vat_tu: mapped.ten_vat_tu || "", ma_vat_tu: mapped.ma_vat_tu || "", existingId: existingItem.rfq_item_id });
      } else {
        summary.changed_same_key++;
        previewItems.push({ sourceRowNumber: srcRow, status: "changed_same_key", stt, ten_vat_tu: mapped.ten_vat_tu || "", ma_vat_tu: mapped.ma_vat_tu || "", existingId: existingItem.rfq_item_id, changedFields });
      }
    }
  }
  return json({ ok: true, summary, rows: previewItems });
}
__name(previewRows, "previewRows");
async function getJob(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const jobId = cleanString(body.jobId || body.job_id, 80);
  if (!jobId) return json({ ok: false, error: "Thieu jobId" }, 400);
  const job = await getImportJobSQL(env.DB, jobId);
  if (!job) return json({ ok: false, error: "Khong tim thay import job" }, 404);
  return json({ ok: true, job });
}
__name(getJob, "getJob");
async function getJobRows(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const jobId = cleanString(body.jobId || body.job_id, 80);
  if (!jobId) return json({ ok: false, error: "Thieu jobId" }, 400);
  const rows = await listImportJobRowsSQL(env.DB, { jobId, limit: clampLimit(body.limit, 100, 500) });
  return json({ ok: true, rows });
}
__name(getJobRows, "getJobRows");
function parseTemplateRow(row) {
  let mappingJson = {};
  try {
    mappingJson = JSON.parse(row.mapping_json || "{}");
  } catch {
    mappingJson = {};
  }
  return { ...row, mappingJson };
}
__name(parseTemplateRow, "parseTemplateRow");
function normalizeMapping(value) {
  const raw = typeof value === "string" ? safeJson(value) : objectOnly(value);
  const out = {};
  for (const [sourceHeader, targetField] of Object.entries(raw)) {
    const source = cleanString(sourceHeader, 180);
    const target = cleanString(targetField, 80);
    if (source && TARGET_FIELDS.has(target)) out[source] = target;
  }
  return out;
}
__name(normalizeMapping, "normalizeMapping");
function sanitizeMapped(mapped) {
  const source = objectOnly(mapped);
  const out = {};
  const LONG_TEXT = /* @__PURE__ */ new Set(["origin_full_text", "yeu_cau_ky_thuat_bo_sung", "technical_params", "note", "ten_vat_tu"]);
  for (const field of TARGET_FIELDS) {
    if (source[field] === void 0 || source[field] === null) continue;
    if (field === "quantity" || field === "thue_suat") out[field] = numberOrEmpty(source[field]);
    else if (["don_gia_sau_thue", "don_gia_truoc_thue", "thanh_tien_sau_thue", "gia_hop_dong"].includes(field)) out[field] = moneyOrEmpty(source[field]);
    else out[field] = cleanString(source[field], LONG_TEXT.has(field) ? 1500 : 500);
  }
  return out;
}
__name(sanitizeMapped, "sanitizeMapped");
async function buildImportItemRow(db, { rfqId, mapped, oldRow, rawRow, sourceRowNumber, sourceSheetName, now, overwriteFields }) {
  const ow = /* @__PURE__ */ __name((field) => !oldRow || !overwriteFields || !overwriteFields.length || overwriteFields.includes(field), "ow");
  const row = oldRow ? { ...oldRow } : emptyItemRow();
  row.trang_thai_dong = oldRow?.trang_thai_dong || "chua_xu_ly";
  row.trang_thai_ky_thuat = oldRow?.trang_thai_ky_thuat || "khong_can_xac_nhan";
  row.rfq_item_id = oldRow ? oldRow.rfq_item_id : await nextEntityId(db, "rfq_items", "rfq_item_id", "RFQI");
  row.rfq_id = rfqId;
  row.created_at = oldRow?.created_at || now;
  row.updated_at = now;
  row.source_sheet_name = sourceSheetName || "csv";
  row.source_row_number = sourceRowNumber;
  row.raw_row_json = JSON.stringify(rawRow);
  if (ow("stt_goc")) setText(row, mapped, "stt_goc", "stt_goc");
  if (!row.stt_goc) row.stt_goc = String(sourceRowNumber - 1);
  if (ow("ma_mua_sam")) setText(row, mapped, "ma_mua_sam", "ma_mua_sam");
  if (ow("ma_vat_tu")) setText(row, mapped, "ma_vat_tu", "ma_vat_tu");
  if (ow("ten_vat_tu")) setText(row, mapped, "ten_vat_tu", "ten_vat_tu");
  if (ow("required_model")) setText(row, mapped, "required_model", "required_model");
  if (ow("manufacturer")) setText(row, mapped, "manufacturer", "manufacturer");
  if (ow("brand")) setText(row, mapped, "brand", "brand");
  if (ow("origin_country")) setText(row, mapped, "origin_country", "origin_country");
  if (ow("unit")) setText(row, mapped, "unit", "unit");
  if (ow("manufacture_year")) setText(row, mapped, "manufacture_year", "manufacture_year");
  if (ow("technical_params")) setText(row, mapped, "technical_params", "technical_params");
  if (ow("vat_lieu")) setText(row, mapped, "vat_lieu", "vat_lieu");
  if (ow("phu_tung_chuyen_dung")) setText(row, mapped, "phu_tung_chuyen_dung", "phu_tung_chuyen_dung");
  if (ow("yeu_cau_ky_thuat_bo_sung")) setText(row, mapped, "yeu_cau_ky_thuat_bo_sung", "yeu_cau_ky_thuat_bo_sung");
  if (ow("note")) setText(row, mapped, "note", "note");
  if (ow("delivery_time")) setText(row, mapped, "delivery_time", "delivery_time");
  if (ow("origin_full_text")) setText(row, mapped, "origin_full_text", "origin_full_text");
  if (ow("quantity")) setNumber(row, mapped, "quantity", "quantity");
  if (ow("thue_suat")) setNumber(row, mapped, "thue_suat", "thue_suat");
  if (ow("don_gia_truoc_thue")) setMoney(row, mapped, "don_gia_truoc_thue", "don_gia_truoc_thue");
  if (ow("don_gia_sau_thue")) setMoney(row, mapped, "don_gia_sau_thue", "don_gia_sau_thue");
  if (ow("thanh_tien_sau_thue")) setMoney(row, mapped, "thanh_tien_sau_thue", "thanh_tien_sau_thue");
  if (ow("gia_hop_dong")) setMoney(row, mapped, "gia_hop_dong", "gia_hop_dong");
  if (ow("quy_cach_final")) setText(row, mapped, "quy_cach_final", "quy_cach_final");
  if (ow("hang_final")) setText(row, mapped, "hang_final", "hang_final");
  if (ow("xuat_xu_final")) setText(row, mapped, "xuat_xu_final", "xuat_xu_final");
  if (ow("ghi_chu_final")) setText(row, mapped, "ghi_chu_final", "ghi_chu_final");
  row.quy_cach_model_yeu_cau = row.required_model;
  row.hang_goc_nsx_goc = row.manufacturer;
  row.nhan_hieu = row.brand;
  row.xuat_xu = row.origin_country;
  row.nam_san_xuat = row.manufacture_year;
  row.thong_so_ky_thuat = row.technical_params || "";
  row.so_luong = row.quantity || 0;
  row.don_vi = row.unit;
  row.normalized_search = buildSearchText([
    row.ma_mua_sam,
    row.ma_vat_tu,
    row.ten_vat_tu,
    row.required_model,
    row.brand,
    row.manufacturer,
    row.origin_country,
    row.manufacture_year,
    row.technical_params,
    row.vat_lieu,
    row.yeu_cau_ky_thuat_bo_sung,
    row.quy_cach_final,
    row.hang_final,
    row.xuat_xu_final,
    row.ghi_chu_final
  ]);
  return row;
}
__name(buildImportItemRow, "buildImportItemRow");
function emptyItemRow() {
  return {
    rfq_item_id: "",
    rfq_id: "",
    stt_goc: "",
    id_import_goc: "",
    ma_mua_sam: "",
    ma_vat_tu: "",
    ten_vat_tu: "",
    required_model: "",
    brand: "",
    manufacture_year: "",
    origin_country: "",
    manufacturer: "",
    technical_params: "",
    unit: "",
    quantity: 0,
    origin_full_text: "",
    delivery_time: "",
    note: "",
    quy_cach_model_yeu_cau: "",
    hang_goc_nsx_goc: "",
    hang_bao_gia_nsx_bao_gia: "",
    nhan_hieu: "",
    xuat_xu: "",
    nam_san_xuat: "",
    vat_lieu: "",
    phu_tung_chuyen_dung: "",
    thong_so_ky_thuat: "",
    yeu_cau_ky_thuat_bo_sung: "",
    so_luong: 0,
    don_vi: "",
    thue_suat: 0,
    don_gia_truoc_thue: 0,
    don_gia_sau_thue: 0,
    thanh_tien_sau_thue: 0,
    gia_hop_dong: 0,
    nguon_gia: "",
    trang_thai_dong: "chua_xu_ly",
    trang_thai_ky_thuat: "khong_can_xac_nhan",
    quy_cach_final: "",
    hang_final: "",
    xuat_xu_final: "",
    ghi_chu_final: "",
    item_id: "",
    normalized_search: "",
    raw_row_json: "",
    source_file_id: "",
    source_sheet_name: "",
    source_row_number: 0,
    created_at: "",
    updated_at: ""
  };
}
__name(emptyItemRow, "emptyItemRow");
function setText(row, mapped, field, target) {
  if (mapped[field] !== void 0 && mapped[field] !== "") row[target] = cleanString(mapped[field], TEXT_FIELDS.includes(field) ? 1500 : 500);
}
__name(setText, "setText");
function setNumber(row, mapped, field, target) {
  if (mapped[field] !== void 0 && mapped[field] !== "") row[target] = cleanNumber(mapped[field]);
}
__name(setNumber, "setNumber");
function setMoney(row, mapped, field, target) {
  if (mapped[field] !== void 0 && mapped[field] !== "") row[target] = cleanMoney(mapped[field]);
}
__name(setMoney, "setMoney");
function objectOnly(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
__name(objectOnly, "objectOnly");
function safeJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}
__name(safeJson, "safeJson");
function positiveInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}
__name(positiveInt, "positiveInt");
function numberOrEmpty(value) {
  return value === "" || value === null || value === void 0 ? "" : cleanNumber(value);
}
__name(numberOrEmpty, "numberOrEmpty");
function moneyOrEmpty(value) {
  return value === "" || value === null || value === void 0 ? "" : cleanMoney(value);
}
__name(moneyOrEmpty, "moneyOrEmpty");

// src/worker/db/item-queries.js
async function searchItemsSQL(db, params) {
  const { q, maVatTu, status, cursorUpdatedAt, cursorItemId, limit } = params;
  const conds = [];
  const binds = [];
  if (status) {
    conds.push("status = ?");
    binds.push(status);
  }
  if (maVatTu) {
    conds.push("ma_vat_tu = ?");
    binds.push(maVatTu);
  }
  if (q) {
    const like = `%${q}%`;
    conds.push("(normalized_search LIKE ? OR ma_vat_tu LIKE ? OR ten_vat_tu LIKE ? OR required_model LIKE ? OR manufacturer LIKE ? OR brand LIKE ?)");
    binds.push(like, like, like, like, like, like);
  }
  if (cursorUpdatedAt && cursorItemId) {
    conds.push("(updated_at < ? OR (updated_at = ? AND item_id < ?))");
    binds.push(cursorUpdatedAt, cursorUpdatedAt, cursorItemId);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const res = await db.prepare(
    `SELECT *
     FROM items
     ${where}
     ORDER BY updated_at DESC, item_id DESC
     LIMIT ?`
  ).bind(...binds, limit).all();
  return res.results || [];
}
__name(searchItemsSQL, "searchItemsSQL");
async function getItemSQL(db, itemId) {
  return db.prepare("SELECT * FROM items WHERE item_id = ?").bind(itemId).first();
}
__name(getItemSQL, "getItemSQL");
async function getItemDetailSQL(db, itemId) {
  const item = await getItemSQL(db, itemId);
  if (!item) return null;
  const linked = await db.prepare(
    `SELECT COUNT(*) AS linked_count
     FROM rfq_items
     WHERE item_id = ?`
  ).bind(itemId).first();
  const quotes = await db.prepare(
    `SELECT COUNT(*) AS quote_count
     FROM supplier_quotes sq
     JOIN rfq_items ri ON ri.rfq_item_id = sq.rfq_item_id
     WHERE ri.item_id = ?`
  ).bind(itemId).first();
  return {
    ...item,
    linked_rfq_item_count: Number(linked?.linked_count || 0),
    quote_count: Number(quotes?.quote_count || 0)
  };
}
__name(getItemDetailSQL, "getItemDetailSQL");
async function insertItemSQL(db, row) {
  return db.prepare(
    `INSERT INTO items (
      item_id, ma_vat_tu, ten_vat_tu, required_model, manufacturer, brand,
      origin_country, unit, technical_params, note, normalized_search, status,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.item_id,
    row.ma_vat_tu,
    row.ten_vat_tu,
    row.required_model,
    row.manufacturer,
    row.brand,
    row.origin_country,
    row.unit,
    row.technical_params,
    row.note,
    row.normalized_search,
    row.status,
    row.created_by,
    row.created_at,
    row.updated_at
  ).run();
}
__name(insertItemSQL, "insertItemSQL");
async function updateItemSQL(db, row) {
  return db.prepare(
    `UPDATE items SET
      ma_vat_tu = ?, ten_vat_tu = ?, required_model = ?, manufacturer = ?, brand = ?,
      origin_country = ?, unit = ?, technical_params = ?, note = ?, normalized_search = ?,
      status = ?, updated_at = ?
     WHERE item_id = ?`
  ).bind(
    row.ma_vat_tu,
    row.ten_vat_tu,
    row.required_model,
    row.manufacturer,
    row.brand,
    row.origin_country,
    row.unit,
    row.technical_params,
    row.note,
    row.normalized_search,
    row.status,
    row.updated_at,
    row.item_id
  ).run();
}
__name(updateItemSQL, "updateItemSQL");
async function linkRfqItemToItemSQL(db, rfqItemId, itemId, updatedAt) {
  return db.prepare(
    `UPDATE rfq_items
     SET item_id = ?, updated_at = ?
     WHERE rfq_item_id = ?`
  ).bind(itemId, updatedAt, rfqItemId).run();
}
__name(linkRfqItemToItemSQL, "linkRfqItemToItemSQL");
async function unlinkRfqItemFromItemSQL(db, rfqItemId, updatedAt) {
  return db.prepare(
    `UPDATE rfq_items
     SET item_id = NULL, updated_at = ?
     WHERE rfq_item_id = ?`
  ).bind(updatedAt, rfqItemId).run();
}
__name(unlinkRfqItemFromItemSQL, "unlinkRfqItemFromItemSQL");
async function suggestItemsSQL(db, params) {
  const { maVatTu, normalizedNeedle, nameLike, modelLike, manufacturerLike, brandLike, originLike, unitLike, limit } = params;
  const conds = [];
  const binds = [];
  if (maVatTu) {
    conds.push("ma_vat_tu = ?");
    binds.push(maVatTu);
  }
  const needle = normalizedNeedle ? normalizedNeedle.slice(0, 120) : "";
  if (needle) {
    conds.push("normalized_search LIKE ?");
    binds.push(`%${needle}%`);
  }
  if (nameLike) {
    conds.push("ten_vat_tu LIKE ?");
    binds.push(`%${nameLike}%`);
  }
  if (modelLike) {
    conds.push("required_model LIKE ?");
    binds.push(`%${modelLike}%`);
  }
  if (manufacturerLike) {
    conds.push("manufacturer LIKE ?");
    binds.push(`%${manufacturerLike}%`);
  }
  if (brandLike) {
    conds.push("brand LIKE ?");
    binds.push(`%${brandLike}%`);
  }
  if (originLike) {
    conds.push("origin_country LIKE ?");
    binds.push(`%${originLike}%`);
  }
  if (unitLike) {
    conds.push("unit = ?");
    binds.push(unitLike);
  }
  if (!conds.length) return [];
  const res = await db.prepare(
    `SELECT * FROM items
     WHERE status = 'active' AND (${conds.join(" OR ")})
     ORDER BY updated_at DESC, item_id DESC
     LIMIT ?`
  ).bind(...binds, limit).all();
  const rows = res.results || [];
  const needleLower = needle.toLowerCase();
  const nameLower = (nameLike || "").toLowerCase();
  const modelLower = (modelLike || "").toLowerCase();
  const mfgLower = (manufacturerLike || "").toLowerCase();
  const brandLower = (brandLike || "").toLowerCase();
  return rows.map(function(row) {
    var score = 0;
    if (maVatTu && row.ma_vat_tu === maVatTu) score += 100;
    if (needleLower && (row.normalized_search || "").includes(needleLower)) score += 30;
    if (nameLower && (row.ten_vat_tu || "").toLowerCase().includes(nameLower)) score += 15;
    if (modelLower && (row.required_model || "").toLowerCase().includes(modelLower)) score += 12;
    if (mfgLower && (row.manufacturer || "").toLowerCase().includes(mfgLower)) score += 8;
    if (brandLower && (row.brand || "").toLowerCase().includes(brandLower)) score += 6;
    return Object.assign({}, row, { match_score: score });
  }).sort(function(a, b) {
    return b.match_score - a.match_score;
  });
}
__name(suggestItemsSQL, "suggestItemsSQL");

// src/worker/handlers/items.js
var VALID_ITEM_STATUS = /* @__PURE__ */ new Set(["active", "inactive"]);
async function handleItems(action, request, env, ctx, actor) {
  if (action === "searchMasterItems") return searchMasterItems(request, env, actor);
  if (action === "getMasterItemDetail") return getMasterItemDetail(request, env, actor);
  if (action === "suggestMasterItemsForRfqItem") return suggestMasterItemsForRfqItem(request, env, actor);
  if (action === "createMasterItem") return createMasterItem(request, env, ctx, actor);
  if (action === "updateMasterItem") return updateMasterItem(request, env, ctx, actor);
  if (action === "linkRfqItemToMaster") return linkRfqItemToMaster(request, env, ctx, actor);
  if (action === "unlinkRfqItemFromMaster") return unlinkRfqItemFromMaster(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown item action" }, 400);
}
__name(handleItems, "handleItems");
async function searchMasterItems(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const cursor = cleanString(body.cursor || "", 160);
  const parts = cursor ? cursor.split("|") : [];
  const status = normalizeStatus(body.status || "active", true);
  if (status === null) return json({ ok: false, error: "status khong hop le" }, 400);
  const limit = clampLimit(body.limit, 50, 100);
  const rowsAll = await searchItemsSQL(env.DB, {
    q: normalizeText(body.q || ""),
    maVatTu: cleanString(body.maVatTu ?? body.ma_vat_tu, 120),
    status,
    cursorUpdatedAt: parts.length === 2 ? parts[0] : "",
    cursorItemId: parts.length === 2 ? parts[1] : "",
    limit: limit + 1
  });
  const hasMore = rowsAll.length > limit;
  const rows = hasMore ? rowsAll.slice(0, limit) : rowsAll;
  const last = rows[rows.length - 1];
  return json({
    ok: true,
    rows,
    hasMore,
    nextCursor: hasMore && last ? `${last.updated_at}|${last.item_id}` : ""
  });
}
__name(searchMasterItems, "searchMasterItems");
async function getMasterItemDetail(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const itemId = cleanString(body.itemId ?? body.item_id, 80);
  if (!itemId) return json({ ok: false, error: "Thieu ma master item" }, 400);
  const item = await getItemDetailSQL(env.DB, itemId);
  if (!item) return json({ ok: false, error: "Khong tim thay master item" }, 404);
  return json({ ok: true, item });
}
__name(getMasterItemDetail, "getMasterItemDetail");
async function suggestMasterItemsForRfqItem(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId ?? body.rfq_item_id, 80);
  if (!rfqItemId) return json({ ok: false, error: "Thieu ma dong vat tu" }, 400);
  const rfqItem = await getRfqItemSQL(env.DB, rfqItemId);
  if (!rfqItem) return json({ ok: false, error: "Khong tim thay dong vat tu" }, 404);
  const rows = await suggestItemsSQL(env.DB, suggestionParamsFromRfqItem(rfqItem));
  return json({ ok: true, rows });
}
__name(suggestMasterItemsForRfqItem, "suggestMasterItemsForRfqItem");
async function createMasterItem(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();
  const sourceRfqItemId = cleanString(body.sourceRfqItemId ?? body.source_rfq_item_id, 80);
  const sourceItem = sourceRfqItemId ? await getRfqItemSQL(env.DB, sourceRfqItemId) : null;
  if (sourceRfqItemId && !sourceItem) return json({ ok: false, error: "Khong tim thay dong vat tu nguon" }, 404);
  const row = normalizeItemRow(body, sourceItem, {
    item_id: await nextEntityId(env.DB, "items", "item_id", "ITM"),
    status: "active",
    created_by: actor.id,
    created_at: now,
    updated_at: now
  });
  if (!row.ten_vat_tu) return json({ ok: false, error: "Ten master item la bat buoc" }, 400);
  await insertItemSQL(env.DB, row);
  let linkedItem = null;
  if (sourceItem) {
    await linkRfqItemToItemSQL(env.DB, sourceItem.rfq_item_id, row.item_id, now);
    linkedItem = { ...sourceItem, item_id: row.item_id, updated_at: now };
  }
  ctx.waitUntil(writeActionLog(env, {
    action: "createMasterItem",
    entityType: "item",
    entityId: row.item_id,
    oldJson: null,
    newJson: { item: row, linkedRfqItem: linkedItem },
    actor
  }));
  return json({ ok: true, item: row, linkedRfqItem: linkedItem });
}
__name(createMasterItem, "createMasterItem");
async function updateMasterItem(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const itemId = cleanString(body.itemId ?? body.item_id, 80);
  if (!itemId) return json({ ok: false, error: "Thieu ma master item" }, 400);
  const oldRow = await getItemSQL(env.DB, itemId);
  if (!oldRow) return json({ ok: false, error: "Khong tim thay master item" }, 404);
  const status = normalizeStatus(body.status ?? oldRow.status, false);
  if (status === null) return json({ ok: false, error: "status khong hop le" }, 400);
  const row = normalizeItemRow(body, oldRow, {
    item_id: oldRow.item_id,
    status,
    created_by: oldRow.created_by,
    created_at: oldRow.created_at,
    updated_at: nowIso()
  });
  if (!row.ten_vat_tu) return json({ ok: false, error: "Ten master item la bat buoc" }, 400);
  await updateItemSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: "updateMasterItem",
    entityType: "item",
    entityId: row.item_id,
    oldJson: oldRow,
    newJson: row,
    actor
  }));
  return json({ ok: true, item: row });
}
__name(updateMasterItem, "updateMasterItem");
async function linkRfqItemToMaster(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId ?? body.rfq_item_id, 80);
  const itemId = cleanString(body.itemId ?? body.item_id, 80);
  if (!rfqItemId || !itemId) return json({ ok: false, error: "Thieu ma dong vat tu hoac master item" }, 400);
  const oldRfqItem = await getRfqItemSQL(env.DB, rfqItemId);
  if (!oldRfqItem) return json({ ok: false, error: "Khong tim thay dong vat tu" }, 404);
  const item = await getItemSQL(env.DB, itemId);
  if (!item || item.status !== "active") return json({ ok: false, error: "Khong tim thay master item active" }, 404);
  const now = nowIso();
  await linkRfqItemToItemSQL(env.DB, rfqItemId, itemId, now);
  const newRfqItem = { ...oldRfqItem, item_id: itemId, updated_at: now };
  ctx.waitUntil(writeActionLog(env, {
    action: "linkRfqItemToMaster",
    entityType: "rfq_item",
    entityId: rfqItemId,
    oldJson: oldRfqItem,
    newJson: newRfqItem,
    actor
  }));
  return json({ ok: true, item, rfqItem: newRfqItem });
}
__name(linkRfqItemToMaster, "linkRfqItemToMaster");
async function unlinkRfqItemFromMaster(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId ?? body.rfq_item_id, 80);
  if (!rfqItemId) return json({ ok: false, error: "Thieu ma dong vat tu" }, 400);
  const oldRfqItem = await getRfqItemSQL(env.DB, rfqItemId);
  if (!oldRfqItem) return json({ ok: false, error: "Khong tim thay dong vat tu" }, 404);
  const now = nowIso();
  await unlinkRfqItemFromItemSQL(env.DB, rfqItemId, now);
  const newRfqItem = { ...oldRfqItem, item_id: null, updated_at: now };
  ctx.waitUntil(writeActionLog(env, {
    action: "unlinkRfqItemFromMaster",
    entityType: "rfq_item",
    entityId: rfqItemId,
    oldJson: oldRfqItem,
    newJson: newRfqItem,
    actor
  }));
  return json({ ok: true, rfqItem: newRfqItem });
}
__name(unlinkRfqItemFromMaster, "unlinkRfqItemFromMaster");
function normalizeItemRow(body, fallback, base) {
  const row = {
    ...base,
    ma_vat_tu: firstText(body, fallback, ["maVatTu", "ma_vat_tu"], "ma_vat_tu", 120),
    ten_vat_tu: firstText(body, fallback, ["tenVatTu", "ten_vat_tu"], "ten_vat_tu", 500),
    required_model: firstText(body, fallback, ["requiredModel", "required_model"], "required_model", 1e3),
    manufacturer: firstText(body, fallback, ["manufacturer"], "manufacturer", 180),
    brand: firstText(body, fallback, ["brand"], "brand", 120),
    origin_country: firstText(body, fallback, ["originCountry", "origin_country"], "origin_country", 120),
    unit: firstText(body, fallback, ["unit"], "unit", 80),
    technical_params: firstText(body, fallback, ["technicalParams", "technical_params"], "technical_params", 2e3),
    note: firstText(body, fallback, ["note"], "note", 2e3)
  };
  row.normalized_search = buildSearchText([
    row.ma_vat_tu,
    row.ten_vat_tu,
    row.required_model,
    row.manufacturer,
    row.brand,
    row.origin_country,
    row.unit,
    row.technical_params
  ]);
  return row;
}
__name(normalizeItemRow, "normalizeItemRow");
function firstText(body, fallback, bodyKeys, fallbackKey, max) {
  for (const key of bodyKeys) {
    if (body[key] !== void 0 && body[key] !== null) return cleanString(body[key], max);
  }
  return cleanString(fallback?.[fallbackKey], max);
}
__name(firstText, "firstText");
function normalizeStatus(value, allowEmpty) {
  const status = cleanString(value || "", 20).toLowerCase();
  if (!status && allowEmpty) return "";
  return VALID_ITEM_STATUS.has(status) ? status : null;
}
__name(normalizeStatus, "normalizeStatus");
function suggestionParamsFromRfqItem(row) {
  const name = cleanString(row.ten_vat_tu, 180);
  const model = cleanString(row.required_model || row.quy_cach_model_yeu_cau, 180);
  const manufacturer = cleanString(row.manufacturer || row.hang_goc_nsx_goc, 120);
  const brand = cleanString(row.brand || row.nhan_hieu, 120);
  const origin = cleanString(row.origin_country || row.xuat_xu, 120);
  const unit = cleanString(row.unit || row.don_vi, 80);
  return {
    maVatTu: cleanString(row.ma_vat_tu, 120),
    normalizedNeedle: buildSearchText([row.ma_vat_tu, name, model, manufacturer, brand, origin, unit]),
    nameLike: name,
    modelLike: model,
    manufacturerLike: manufacturer,
    brandLike: brand,
    originLike: origin,
    unitLike: unit,
    limit: 10
  };
}
__name(suggestionParamsFromRfqItem, "suggestionParamsFromRfqItem");

// src/worker/db/media-queries.js
async function insertMediaFileSQL(db, row) {
  return db.prepare(
    `INSERT INTO media_files (file_id, owner_type, owner_id, file_kind, r2_key, public_url, file_name, mime_type,
      size_bytes, width, height, variant, is_primary, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.file_id, row.owner_type, row.owner_id, row.file_kind, row.r2_key, row.public_url, row.file_name, row.mime_type, row.size_bytes, row.width, row.height, row.variant, row.is_primary, row.created_by, row.created_at).run();
}
__name(insertMediaFileSQL, "insertMediaFileSQL");
async function listMediaFilesSQL(db, { ownerType, ownerId, limit }) {
  const res = await db.prepare(
    `SELECT file_id, owner_type, owner_id, file_kind, file_name, mime_type, size_bytes,
      width, height, variant, is_primary, created_by, created_at
     FROM media_files
     WHERE owner_type = ? AND owner_id = ?
     ORDER BY created_at DESC, file_id DESC LIMIT ?`
  ).bind(ownerType, ownerId, limit).all();
  return res.results || [];
}
__name(listMediaFilesSQL, "listMediaFilesSQL");
async function getOrphanMediaReportSQL(db) {
  const [quoteRow, rfqItemRow, samplesRes] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS n FROM media_files mf
       WHERE mf.owner_type = 'quote'
         AND NOT EXISTS (
           SELECT 1 FROM supplier_quotes sq WHERE sq.quote_id = mf.owner_id
         )`
    ).first(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM media_files mf
       WHERE mf.owner_type = 'rfq_item'
         AND NOT EXISTS (
           SELECT 1 FROM rfq_items ri WHERE ri.rfq_item_id = mf.owner_id
         )`
    ).first(),
    db.prepare(
      `SELECT mf.file_id, mf.owner_type, mf.owner_id, mf.file_kind, mf.r2_key, mf.created_at
       FROM media_files mf
       WHERE
         (mf.owner_type = 'quote' AND NOT EXISTS (
           SELECT 1 FROM supplier_quotes sq WHERE sq.quote_id = mf.owner_id
         ))
         OR
         (mf.owner_type = 'rfq_item' AND NOT EXISTS (
           SELECT 1 FROM rfq_items ri WHERE ri.rfq_item_id = mf.owner_id
         ))
       ORDER BY mf.created_at ASC LIMIT 20`
    ).all()
  ]);
  return {
    quote_orphan_count: quoteRow?.n || 0,
    rfq_item_orphan_count: rfqItemRow?.n || 0,
    samples: samplesRes.results || []
  };
}
__name(getOrphanMediaReportSQL, "getOrphanMediaReportSQL");
async function getMediaKeysByOwnerSQL(db, ownerType, ownerId) {
  const res = await db.prepare(
    `SELECT file_id, r2_key FROM media_files
     WHERE owner_type = ? AND owner_id = ?`
  ).bind(ownerType, ownerId).all();
  return res.results || [];
}
__name(getMediaKeysByOwnerSQL, "getMediaKeysByOwnerSQL");
async function deleteMediaFilesByOwnerSQL(db, ownerType, ownerId) {
  return db.prepare(
    `DELETE FROM media_files WHERE owner_type = ? AND owner_id = ?`
  ).bind(ownerType, ownerId).run();
}
__name(deleteMediaFilesByOwnerSQL, "deleteMediaFilesByOwnerSQL");
async function getMediaFileSQL(db, fileId) {
  const res = await db.prepare(
    `SELECT file_id, owner_type, owner_id, file_kind, r2_key, file_name, mime_type, size_bytes,
      width, height, variant, is_primary, created_by, created_at
     FROM media_files
     WHERE file_id = ?`
  ).bind(fileId).first();
  return res || null;
}
__name(getMediaFileSQL, "getMediaFileSQL");

// src/worker/handlers/media.js
var UPLOAD_ROLES = /* @__PURE__ */ new Set(["admin", "manager", "purchasing"]);
var MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
var ALLOWED_UPLOADS = /* @__PURE__ */ new Set([
  "quote:quote_pdf",
  "quote:quote_evidence_image",
  "rfq_item:document_pdf",
  "rfq_item:item_image"
]);
var PDF_KINDS = /* @__PURE__ */ new Set(["quote_pdf", "document_pdf"]);
var IMAGE_KINDS = /* @__PURE__ */ new Set(["item_image", "quote_evidence_image"]);
async function handleMedia(action, request, env, ctx, actor) {
  if (action === "getMediaFiles") return listMedia(request, env, actor);
  if (action === "uploadMedia") return uploadMedia(request, env, ctx, actor);
  if (action === "getMediaFileContent") return getMediaContent(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown media action" }, 400);
}
__name(handleMedia, "handleMedia");
async function listMedia(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const ownerType = cleanString(p.ownerType || p.owner_type, 40);
  const ownerId = cleanString(p.ownerId || p.owner_id, 120);
  if (!ownerType || !ownerId) return json({ ok: false, error: "Thieu ownerType hoac ownerId" }, 400);
  const rows = await listMediaFilesSQL(env.DB, {
    ownerType,
    ownerId,
    limit: clampLimit(p.limit, 50, 100)
  });
  return json({ ok: true, rows: rows.map(compactMediaRow) });
}
__name(listMedia, "listMedia");
async function uploadMedia(request, env, ctx, actor) {
  const denied = requireRole(actor, UPLOAD_ROLES);
  if (denied) return denied;
  if (!env.MEDIA) return json({ ok: false, error: "R2 MEDIA binding chua cau hinh" }, 500);
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return json({ ok: false, error: "Thieu file upload" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ ok: false, error: "File toi da 10MB" }, 400);
  const browserType = cleanString(file.type || "", 120).toLowerCase();
  const ownerType = cleanString(form.get("ownerType") || form.get("owner_type"), 40);
  const ownerId = cleanString(form.get("ownerId") || form.get("owner_id"), 120);
  const fileKind = cleanString(form.get("fileKind") || form.get("file_kind"), 40);
  if (!ownerType || !ownerId || !fileKind) {
    return json({ ok: false, error: "Thieu ownerType, ownerId hoac fileKind" }, 400);
  }
  if (!ALLOWED_UPLOADS.has(`${ownerType}:${fileKind}`)) {
    return json({ ok: false, error: "Loai file upload khong duoc ho tro" }, 400);
  }
  const bytes = await file.arrayBuffer();
  const detected = detectFileType(bytes);
  const uploadType = validateUploadType(fileKind, browserType, detected);
  if (uploadType.error) return json({ ok: false, error: uploadType.error }, 400);
  const fileId = makeId("FILE");
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
    public_url: "",
    file_name: displayName,
    mime_type: uploadType.mimeType,
    size_bytes: file.size || 0,
    width: positiveInt2(form.get("width")),
    height: positiveInt2(form.get("height")),
    variant: "original",
    is_primary: 0,
    created_by: actor.id,
    created_at: nowIso()
  };
  await insertMediaFileSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: "uploadMedia",
    entityType: "media_file",
    entityId: fileId,
    message: `${actor.displayName || actor.username || actor.id} uploaded ${ownerType}/${ownerId}/${fileKind}`,
    newJson: compactMediaRow(row),
    actor
  }));
  return json({ ok: true, file: compactMediaRow(row) });
}
__name(uploadMedia, "uploadMedia");
async function getMediaContent(request, env, ctx, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  if (!env.MEDIA) return json({ ok: false, error: "R2 MEDIA binding chua cau hinh" }, 500);
  const p = await readJson(request);
  const fileId = cleanString(p.fileId || p.file_id, 80);
  if (!fileId) return json({ ok: false, error: "Thieu fileId" }, 400);
  const row = await getMediaFileSQL(env.DB, fileId);
  if (!row) return json({ ok: false, error: "Khong tim thay file" }, 404);
  const object = await env.MEDIA.get(row.r2_key);
  if (!object) return json({ ok: false, error: "File khong con trong R2" }, 404);
  ctx.waitUntil(writeActionLog(env, {
    action: "downloadMedia",
    entityType: "media_file",
    entityId: row.file_id,
    message: `${actor.displayName || actor.username || actor.id} downloaded ${row.owner_type}/${row.owner_id}/${row.file_kind}: ${row.file_name || row.file_id}`,
    actor
  }));
  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": row.mime_type || object.httpMetadata?.contentType || "application/octet-stream",
      "content-disposition": `inline; filename="${contentDispositionName(row.file_name || row.file_id)}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
__name(getMediaContent, "getMediaContent");
function validateUploadType(fileKind, browserType, detected) {
  if (PDF_KINDS.has(fileKind)) {
    if (browserType && browserType !== "application/pdf") return { error: "File PDF phai co MIME application/pdf" };
    if (detected !== "pdf") return { error: "File khong phai PDF hop le" };
    return { mimeType: "application/pdf", extension: "pdf" };
  }
  if (IMAGE_KINDS.has(fileKind)) {
    if (browserType && !["image/jpeg", "image/png", "image/webp"].includes(browserType)) {
      return { error: "Anh chi chap nhan JPEG, PNG hoac WebP" };
    }
    if (!["jpeg", "png", "webp"].includes(detected)) {
      return { error: "Anh khong dung dinh dang JPEG, PNG hoac WebP" };
    }
    if (detected === "png") {
      return { error: "Anh PNG phai duoc toi uu qua trinh duyet thanh JPEG truoc khi luu" };
    }
    return {
      mimeType: detected === "webp" ? "image/webp" : "image/jpeg",
      extension: detected === "webp" ? "webp" : "jpg"
    };
  }
  return { error: "Loai file upload khong duoc ho tro" };
}
__name(validateUploadType, "validateUploadType");
function detectFileType(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 5 && bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45) return "pdf";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return "png";
  if (bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return "webp";
  if (bytes.length >= 6 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56 && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97) return "gif";
  return "unknown";
}
__name(detectFileType, "detectFileType");
function sanitizeDisplayName(name, extension) {
  const safeExtension = extension === "webp" ? "webp" : extension === "png" ? "png" : extension === "jpg" ? "jpg" : "pdf";
  const fallback = safeExtension === "pdf" ? "document.pdf" : `image.${safeExtension}`;
  const raw = String(name || fallback).replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]+/g, " ").trim();
  const safe = raw.replace(/\s+/g, " ").slice(0, 160).trim();
  const base = (safe || fallback).replace(/\.[^.]*$/, "").trim() || (safeExtension === "pdf" ? "document" : "image");
  return `${base}.${safeExtension}`;
}
__name(sanitizeDisplayName, "sanitizeDisplayName");
function safeBaseNameFromDisplay(displayName) {
  const noExt = displayName.replace(/\.[^.]*$/, "");
  const ascii = noExt.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").replace(/_+/g, "_").slice(0, 100).replace(/^_+|_+$/g, "");
  return ascii || "file";
}
__name(safeBaseNameFromDisplay, "safeBaseNameFromDisplay");
function positiveInt2(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
__name(positiveInt2, "positiveInt");
function contentDispositionName(name) {
  return String(name || "file").replace(/[\u0000-\u001f\u007f"\\]/g, "").replace(/[\\/]+/g, " ").trim().slice(0, 160) || "file";
}
__name(contentDispositionName, "contentDispositionName");
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
    variant: row.variant || "original",
    is_primary: row.is_primary || 0,
    created_by: row.created_by,
    created_at: row.created_at
  };
}
__name(compactMediaRow, "compactMediaRow");

// src/worker/handlers/rfqs.js
var DASHBOARD_V2_KEY = "dashboard:v2";
var VALID_RFQ_STATUS = /* @__PURE__ */ new Set(["dang_khao_gia", "da_bao", "trung", "khong_trung", "treo", "tham_khao", "archived"]);
async function handleRfqs(action, request, env, ctx, actor) {
  if (action === "getDashboard") return getDashboard(env, actor);
  if (action === "getRfqs") return listRfqs(request, env, actor);
  if (action === "getRfq") return getOneRfq(request, env, actor);
  if (action === "createRfq") return saveRfq(request, env, ctx, actor, false);
  if (action === "updateRfq") return saveRfq(request, env, ctx, actor, true);
  if (action === "archiveRfq") return archiveRfq(request, env, ctx, actor);
  if (action === "quickUpdateRfqStatus") return quickUpdateRfqStatus(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown RFQ action" }, 400);
}
__name(handleRfqs, "handleRfqs");
async function getOneRfq(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const rfqId = p.rfqId || p.rfq_id || "";
  if (!rfqId) return json({ ok: false, error: "Missing rfqId" }, 400);
  const row = await getRfqSQL(env.DB, rfqId);
  if (!row) return json({ ok: false, error: "RFQ not found" }, 404);
  return json({ ok: true, row });
}
__name(getOneRfq, "getOneRfq");
async function getDashboard(env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const cached = await getKv(env, "dashboard:v1");
  if (cached) return json({ ok: true, summary: cached });
  const summary = await getDashboardSQL(env.DB);
  await setKv(env, "dashboard:v1", summary, 300);
  return json({ ok: true, summary });
}
__name(getDashboard, "getDashboard");
async function listRfqs(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const data = await listRfqsSQL(env.DB, { q: normalizeText(p.q), status: p.status || "", cursor: p.cursor || "", sortBy: p.sortBy || "", sortDir: p.sortDir || "", limit: clampLimit(p.limit) });
  return json({ ok: true, ...data });
}
__name(listRfqs, "listRfqs");
async function archiveRfq(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 80);
  if (!rfqId) return json({ ok: false, error: "Thieu ma RFQ" }, 400);
  const row = await getRfqSQL(env.DB, rfqId);
  if (!row) return json({ ok: false, error: "Khong tim thay RFQ" }, 404);
  const now = nowIso();
  await archiveRfqSQL(env.DB, rfqId, now);
  ctx.waitUntil(invalidateKv(env, ["dashboard:v1", DASHBOARD_V2_KEY]));
  ctx.waitUntil(writeActionLog(env, { action: "archiveRfq", entityType: "rfq", entityId: rfqId, message: `L\u01B0u tr\u1EEF g\xF3i th\u1EA7u: "${row.ten_goi}" (${rfqId})`, oldJson: row, newJson: null, actor }));
  return json({ ok: true });
}
__name(archiveRfq, "archiveRfq");
async function quickUpdateRfqStatus(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 80);
  const status = body.status;
  if (!rfqId) return json({ ok: false, error: "Thi\u1EBFu rfq_id" }, 400);
  if (!VALID_RFQ_STATUS.has(status)) return json({ ok: false, error: "Tr\u1EA1ng th\xE1i kh\xF4ng h\u1EE3p l\u1EC7" }, 400);
  const row = await getRfqSQL(env.DB, rfqId);
  if (!row) return json({ ok: false, error: "Kh\xF4ng t\xECm th\u1EA5y RFQ" }, 404);
  const now = nowIso();
  await quickUpdateRfqStatusSQL(env.DB, rfqId, status, now);
  await invalidateKv(env, [DASHBOARD_V2_KEY]);
  ctx.waitUntil(writeActionLog(env, {
    action: "quickUpdateRfqStatus",
    entityType: "rfq",
    entityId: rfqId,
    message: `\u0110\u1ED5i tr\u1EA1ng th\xE1i RFQ "${row.ten_goi}" (${rfqId}): ${row.trang_thai_goi} \u2192 ${status}`,
    oldJson: { trang_thai_goi: row.trang_thai_goi },
    newJson: { trang_thai_goi: status },
    actor
  }));
  return json({ ok: true });
}
__name(quickUpdateRfqStatus, "quickUpdateRfqStatus");
function cleanUrl(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return "";
  return s.slice(0, 2e3);
}
__name(cleanUrl, "cleanUrl");
async function saveRfq(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const title = cleanString(body.tenGoi || body.ten_goi, 240);
  if (!title) return json({ ok: false, error: "Ten goi RFQ la bat buoc" }, 400);
  const now = nowIso();
  const oldRow = isUpdate ? await getRfqSQL(env.DB, body.rfqId || body.rfq_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: "Khong tim thay RFQ" }, 404);
  const rawUrl = body.externalUrl !== void 0 ? body.externalUrl : body.external_url !== void 0 ? body.external_url : oldRow?.external_url || "";
  const row = {
    rfq_id: isUpdate ? oldRow.rfq_id : await nextEntityId(env.DB, "rfqs", "rfq_id", "RFQ"),
    client_id: cleanString(body.clientId || body.client_id, 80),
    ma_goi_tbmt: cleanString(body.maGoiTbmt || body.ma_goi_tbmt, 120),
    ten_goi: title,
    nha_may_cdt: cleanString(body.nhaMayCdt || body.nha_may_cdt, 180),
    ngay_nhan_hoac_dang_tai: cleanString(body.ngayNhanHoacDangTai || body.ngay_nhan_hoac_dang_tai, 20),
    ngay_het_han: cleanString(body.ngayHetHan || body.ngay_het_han, 20),
    du_toan: cleanMoney(body.duToan ?? body.du_toan),
    trang_thai_goi: cleanString(body.trangThaiGoi || body.trang_thai_goi || "dang_khao_gia", 40),
    source_file_id: cleanString(body.sourceFileId || body.source_file_id, 120),
    note: cleanString(body.note, 1500),
    external_url: cleanUrl(rawUrl),
    normalized_search: buildSearchText([title, body.maGoiTbmt, body.ma_goi_tbmt, body.nhaMayCdt, body.nha_may_cdt]),
    created_by: oldRow?.created_by || actor.id,
    created_at: oldRow?.created_at || now,
    updated_at: now
  };
  if (isUpdate) await updateRfqSQL(env.DB, row);
  else await insertRfqSQL(env.DB, row);
  ctx.waitUntil(invalidateKv(env, ["dashboard:v1", DASHBOARD_V2_KEY]));
  ctx.waitUntil(writeActionLog(env, { action: isUpdate ? "updateRfq" : "createRfq", entityType: "rfq", entityId: row.rfq_id, message: isUpdate ? `C\u1EADp nh\u1EADt g\xF3i th\u1EA7u: "${row.ten_goi}" (${row.rfq_id})` : `T\u1EA1o g\xF3i th\u1EA7u m\u1EDBi: "${row.ten_goi}" (${row.rfq_id})`, oldJson: oldRow, newJson: row, actor }));
  return json({ ok: true, rfq: row });
}
__name(saveRfq, "saveRfq");

// src/worker/handlers/rfq-items.js
async function handleRfqItems(action, request, env, ctx, actor) {
  if (action === "getRfqItems") return listItems(request, env, actor);
  if (action === "getRfqItem") return getOneItem(request, env, actor);
  if (action === "createRfqItem") return saveItem(request, env, ctx, actor, false);
  if (action === "updateRfqItem") return saveItem(request, env, ctx, actor, true);
  if (action === "archiveRfqItem") return archiveItem(request, env, ctx, actor);
  if (action === "hardDeleteRfqItems") return hardDelete(request, env, ctx, actor);
  if (action === "hardDeleteAllRfqItems") return hardDeleteAll(request, env, ctx, actor);
  if (action === "logRfqItemImportSummary") return logImportSummary(request, env, ctx, actor);
  if (action === "exportRfqItemsCsv") return exportItems(request, env, actor);
  if (action === "exportRfqItemsJson") return exportItemsJson(request, env, actor);
  return json({ ok: false, error: "Unknown RFQ item action" }, 400);
}
__name(handleRfqItems, "handleRfqItems");
async function getOneItem(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const rfqItemId = p.rfqItemId || p.rfq_item_id || "";
  if (!rfqItemId) return json({ ok: false, error: "Missing rfqItemId" }, 400);
  const row = await getRfqItemSQL(env.DB, rfqItemId);
  if (!row) return json({ ok: false, error: "RFQ item not found" }, 404);
  return json({ ok: true, row });
}
__name(getOneItem, "getOneItem");
async function listItems(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const VALID_TECH_FILTERS = /* @__PURE__ */ new Set(["has_clarification", "no_clarification", "khong_can", "dang_hoi", "da_xac_nhan", "bi_tu_choi"]);
  const data = await listRfqItemsSQL(env.DB, {
    q: normalizeText(p.q),
    q2: normalizeText(p.q2),
    q3: normalizeText(p.q3),
    rfqId: p.rfqId || p.rfq_id || "",
    status: p.status || "",
    techFilter: VALID_TECH_FILTERS.has(p.techFilter) ? p.techFilter : "",
    cursor: p.cursor || "",
    sortBy: p.sortBy || "",
    sortDir: p.sortDir || "",
    limit: clampLimit(p.limit, 500, 1e4)
  });
  return json({ ok: true, ...data });
}
__name(listItems, "listItems");
async function logImportSummary(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 80);
  const rfqName = cleanString(body.rfqName || "", 240);
  const created = Math.max(0, Number(body.created) || 0);
  const updated = Math.max(0, Number(body.updated) || 0);
  const errors = Math.max(0, Number(body.errors) || 0);
  const label = rfqName ? `"${rfqName}" (${rfqId})` : rfqId;
  const parts = [`t\u1EA1o ${created}`, `c\u1EADp nh\u1EADt ${updated}`];
  if (errors) parts.push(`l\u1ED7i ${errors}`);
  ctx.waitUntil(writeActionLog(env, {
    action: "importRfqItems",
    entityType: "rfq_item",
    entityId: rfqId,
    message: `Import d\xF2ng v\u1EADt t\u01B0 v\xE0o g\xF3i ${label}: ${parts.join(", ")}`,
    actor
  }));
  return json({ ok: true });
}
__name(logImportSummary, "logImportSummary");
async function archiveItem(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id, 80);
  if (!rfqItemId) return json({ ok: false, error: "Thieu ma dong vat tu" }, 400);
  const row = await getRfqItemSQL(env.DB, rfqItemId);
  if (!row) return json({ ok: false, error: "Khong tim thay dong vat tu" }, 404);
  const now = nowIso();
  await archiveRfqItemSQL(env.DB, rfqItemId, now);
  ctx.waitUntil(invalidateKv(env, ["dashboard:v1", "dashboard:v2"]));
  ctx.waitUntil(writeActionLog(env, { action: "archiveRfqItem", entityType: "rfq_item", entityId: rfqItemId, oldJson: row, newJson: null, actor }));
  return json({ ok: true });
}
__name(archiveItem, "archiveItem");
async function saveItem(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 80);
  const name = cleanString(body.tenVatTu || body.ten_vat_tu, 500);
  if (!rfqId || !name) return json({ ok: false, error: "RFQ va ten vat tu la bat buoc" }, 400);
  const rfq = await getRfqSQL(env.DB, rfqId);
  if (!rfq) return json({ ok: false, error: "RFQ khong ton tai" }, 400);
  const now = nowIso();
  const oldRow = isUpdate ? await getRfqItemSQL(env.DB, body.rfqItemId || body.rfq_item_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: "Khong tim thay dong RFQ" }, 404);
  const row = normalizeItemRow2(body, {
    rfq_item_id: isUpdate ? oldRow.rfq_item_id : await nextEntityId(env.DB, "rfq_items", "rfq_item_id", "RFQI"),
    rfq_id: rfqId,
    ten_vat_tu: name,
    created_at: oldRow?.created_at || now,
    updated_at: now
  });
  if (isUpdate) await updateRfqItemSQL(env.DB, row);
  else await insertRfqItemSQL(env.DB, row);
  ctx.waitUntil(invalidateKv(env, ["dashboard:v1", "dashboard:v2"]));
  if (!body.silent) {
    ctx.waitUntil(writeActionLog(env, {
      action: isUpdate ? "updateRfqItem" : "createRfqItem",
      entityType: "rfq_item",
      entityId: row.rfq_item_id,
      message: isUpdate ? `C\u1EADp nh\u1EADt d\xF2ng v\u1EADt t\u01B0: "${name}" (${row.rfq_item_id}) \u2014 g\xF3i ${rfqId}` : `Th\xEAm d\xF2ng v\u1EADt t\u01B0: "${name}" \u2014 g\xF3i ${rfqId}`,
      oldJson: oldRow,
      newJson: row,
      actor
    }));
  }
  return json({ ok: true, item: row });
}
__name(saveItem, "saveItem");
function v(body, camel, snake, max = 500) {
  return cleanString(body[camel] ?? body[snake], max);
}
__name(v, "v");
function cleanUrl2(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return "";
  return s.slice(0, 2e3);
}
__name(cleanUrl2, "cleanUrl");
function firstText2(body, keys, max = 500) {
  for (const key of keys) {
    if (body[key] !== void 0 && body[key] !== null) return cleanString(body[key], max);
  }
  return "";
}
__name(firstText2, "firstText");
function firstNumber(body, keys) {
  for (const key of keys) {
    if (body[key] !== void 0 && body[key] !== null) return cleanNumber(body[key]);
  }
  return 0;
}
__name(firstNumber, "firstNumber");
function normalizeItemRow2(body, base) {
  const requiredModel = firstText2(body, ["requiredModel", "required_model", "quyCachModelYeuCau", "quy_cach_model_yeu_cau"], 1e3);
  const brand = firstText2(body, ["brand", "nhanHieu", "nhan_hieu"], 120);
  const manufactureYear = firstText2(body, ["manufactureYear", "manufacture_year", "namSanXuat", "nam_san_xuat"], 40);
  const originCountry = firstText2(body, ["originCountry", "origin_country", "xuatXu", "xuat_xu"], 120);
  const manufacturer = firstText2(body, ["manufacturer", "hangGocNsxGoc", "hang_goc_nsx_goc"], 180);
  const technicalParams = firstText2(body, ["technicalParams", "technical_params", "thongSoKyThuat", "thong_so_ky_thuat"], 2e3);
  const unit = firstText2(body, ["unit", "donVi", "don_vi"], 80);
  const quantity = firstNumber(body, ["quantity", "soLuong", "so_luong"]);
  const row = {
    ...base,
    stt_goc: v(body, "sttGoc", "stt_goc", 40),
    id_import_goc: v(body, "idImportGoc", "id_import_goc", 120),
    ma_mua_sam: v(body, "maMuaSam", "ma_mua_sam", 120),
    ma_vat_tu: v(body, "maVatTu", "ma_vat_tu", 120),
    required_model: requiredModel,
    brand,
    manufacture_year: manufactureYear,
    origin_country: originCountry,
    manufacturer,
    technical_params: technicalParams,
    unit,
    quantity,
    origin_full_text: v(body, "originFullText", "origin_full_text", 1500),
    delivery_time: v(body, "deliveryTime", "delivery_time", 180),
    note: v(body, "note", "note", 1500),
    quy_cach_model_yeu_cau: requiredModel,
    hang_goc_nsx_goc: manufacturer,
    hang_bao_gia_nsx_bao_gia: v(body, "hangBaoGiaNsxBaoGia", "hang_bao_gia_nsx_bao_gia", 180),
    nhan_hieu: brand,
    xuat_xu: originCountry,
    nam_san_xuat: manufactureYear,
    vat_lieu: v(body, "vatLieu", "vat_lieu", 180),
    phu_tung_chuyen_dung: v(body, "phuTungChuyenDung", "phu_tung_chuyen_dung", 80),
    thong_so_ky_thuat: technicalParams,
    yeu_cau_ky_thuat_bo_sung: v(body, "yeuCauKyThuatBoSung", "yeu_cau_ky_thuat_bo_sung", 1500),
    so_luong: quantity,
    don_vi: unit,
    thue_suat: cleanNumber(body.thueSuat ?? body.thue_suat),
    don_gia_truoc_thue: cleanMoney(body.donGiaTruocThue ?? body.don_gia_truoc_thue),
    don_gia_sau_thue: cleanMoney(body.donGiaSauThue ?? body.don_gia_sau_thue),
    thanh_tien_sau_thue: cleanMoney(body.thanhTienSauThue ?? body.thanh_tien_sau_thue),
    gia_hop_dong: cleanMoney(body.giaHopDong ?? body.gia_hop_dong),
    nguon_gia: v(body, "nguonGia", "nguon_gia", 120),
    trang_thai_dong: v(body, "trangThaiDong", "trang_thai_dong", 80) || "chua_xu_ly",
    trang_thai_ky_thuat: v(body, "trangThaiKyThuat", "trang_thai_ky_thuat", 80) || "khong_can_xac_nhan",
    quy_cach_final: v(body, "quyCachFinal", "quy_cach_final", 1e3),
    hang_final: v(body, "hangFinal", "hang_final", 180),
    xuat_xu_final: v(body, "xuatXuFinal", "xuat_xu_final", 120),
    ghi_chu_final: v(body, "ghiChuFinal", "ghi_chu_final", 1500),
    item_id: v(body, "itemId", "item_id", 80),
    raw_row_json: typeof body.rawRowJson === "object" ? JSON.stringify(body.rawRowJson) : v(body, "rawRowJson", "raw_row_json", 5e3),
    source_file_id: v(body, "sourceFileId", "source_file_id", 120),
    source_sheet_name: v(body, "sourceSheetName", "source_sheet_name", 120),
    source_row_number: Math.trunc(cleanNumber(body.sourceRowNumber ?? body.source_row_number)),
    external_url: cleanUrl2(body.externalUrl ?? body.external_url)
  };
  row.normalized_search = buildSearchText([
    row.ma_mua_sam,
    row.ma_vat_tu,
    row.ten_vat_tu,
    row.required_model,
    row.brand,
    row.manufacturer,
    row.origin_country,
    row.manufacture_year,
    row.technical_params,
    row.vat_lieu,
    row.yeu_cau_ky_thuat_bo_sung,
    row.hang_bao_gia_nsx_bao_gia,
    row.note,
    row.quy_cach_final,
    row.hang_final,
    row.xuat_xu_final,
    row.ghi_chu_final
  ]);
  return row;
}
__name(normalizeItemRow2, "normalizeItemRow");
async function hardDelete(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const ids = (body.rfqItemIds || body.rfq_item_ids || []).map((s) => cleanString(s, 80)).filter(Boolean);
  if (!ids.length) return json({ ok: false, error: "Khong co dong nao duoc chon" }, 400);
  if (ids.length > 500) return json({ ok: false, error: "Toi da 500 dong moi lan xoa" }, 400);
  const ph = ids.map(() => "?").join(",");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM technical_clarifications WHERE rfq_item_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`DELETE FROM supplier_quotes WHERE rfq_item_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`DELETE FROM pricing_decisions WHERE rfq_item_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`DELETE FROM contract_items WHERE rfq_item_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`DELETE FROM rfq_item_revisions WHERE rfq_item_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`UPDATE import_job_rows SET rfq_item_id = NULL WHERE rfq_item_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`DELETE FROM rfq_items WHERE rfq_item_id IN (${ph})`).bind(...ids)
  ]);
  ctx.waitUntil(invalidateKv(env, ["dashboard:v1", "dashboard:v2"]));
  ctx.waitUntil(writeActionLog(env, { action: "hardDeleteRfqItems", entityType: "rfq_item", entityId: ids.join(","), actor }));
  return json({ ok: true, deleted: ids.length });
}
__name(hardDelete, "hardDelete");
var EXPORT_MAX_ROWS = 5e3;
var EXPORT_COL_HEADERS = [
  "M\xE3 g\xF3i",
  "T\xEAn g\xF3i",
  "STT",
  "M\xE3 mua s\u1EAFm",
  "M\xE3 v\u1EADt t\u01B0",
  "T\xEAn v\u1EADt t\u01B0 / Danh m\u1EE5c h\xE0ng h\xF3a",
  "K\xFD m\xE3 hi\u1EC7u / Model",
  "Nh\xE3n hi\u1EC7u",
  "N\u0103m s\u1EA3n xu\u1EA5t",
  "Xu\u1EA5t x\u1EE9",
  "H\xE3ng s\u1EA3n xu\u1EA5t",
  "Quy c\xE1ch / th\xF4ng s\u1ED1 k\u1EF9 thu\u1EADt",
  "V\u1EADt li\u1EC7u",
  "Ph\u1EE5 t\xF9ng chuy\xEAn d\u1EE5ng",
  "Y\xEAu c\u1EA7u k\u1EF9 thu\u1EADt b\u1ED5 sung",
  "\u0110\u01A1n v\u1ECB t\xEDnh",
  "Kh\u1ED1i l\u01B0\u1EE3ng",
  "Thu\u1EBF su\u1EA5t",
  "\u0110\u01A1n gi\xE1",
  "Th\xE0nh ti\u1EC1n",
  "\u0110\u01A1n gi\xE1 H\u0110",
  "Th\xE0nh ti\u1EC1n H\u0110",
  "Th\u1EDDi gian giao h\xE0ng",
  "Ghi ch\xFA",
  "L\xE0m r\xF5"
];
function maVatTuExcel(v2) {
  if (v2 == null || v2 === "") return "";
  return '="' + String(v2).replace(/"/g, '""') + '"';
}
__name(maVatTuExcel, "maVatTuExcel");
function rowToExportCsv(r) {
  return [
    r.ma_goi_tbmt,
    r.ten_goi,
    r.stt_goc,
    r.ma_mua_sam,
    maVatTuExcel(r.ma_vat_tu),
    r.ten_vat_tu,
    r.required_model || r.quy_cach_model_yeu_cau || "",
    r.brand || r.nhan_hieu || "",
    r.manufacture_year || r.nam_san_xuat || "",
    r.origin_country || r.xuat_xu || "",
    r.manufacturer || r.hang_goc_nsx_goc || "",
    r.technical_params || r.thong_so_ky_thuat || "",
    r.vat_lieu || "",
    r.phu_tung_chuyen_dung || "",
    r.yeu_cau_ky_thuat_bo_sung || "",
    r.unit || r.don_vi || "",
    r.quantity ?? r.so_luong ?? "",
    r.thue_suat ?? "",
    r.don_gia_truoc_thue || r.don_gia_sau_thue || "",
    r.thanh_tien_sau_thue || "",
    r.gia_hop_dong || "",
    r.gia_hop_dong ? r.gia_hop_dong * (parseFloat(r.quantity ?? r.so_luong ?? 0) || 0) : "",
    r.delivery_time || "",
    r.note || "",
    r.latest_clarification_title || ""
  ];
}
__name(rowToExportCsv, "rowToExportCsv");
var EXPORT_TEMPLATES = {
  vt1_lam_ro_1: {
    headers: ["\u7F16\u53F7", "\u9700\u6C42\u8BA1\u5212\u7F16\u53F7", "\u7269\u8D44\u7F16\u7801", "\u7269\u8D44\u540D\u79F0", "\u89C4\u683C\u578B\u53F7", "\u539F\u8BBE\u5907\u5236\u9020\u5546\u751F\u4EA7\u5382", "\u6295\u6807\u8BBE\u5907\u54C1\u724C/\u751F\u4EA7\u5382", "\u8BA2\u8D2D\u5355\u4F4D", "\u8BA2\u8D2D\u6570\u91CF", "\u4EA4\u8D27\u65F6\u95F4", "\u5907\u6CE8", "\u95EE\u9898"],
    row: /* @__PURE__ */ __name((r) => [
      r.stt_goc,
      r.ma_mua_sam,
      maVatTuExcel(r.ma_vat_tu),
      r.ten_vat_tu,
      r.required_model || r.quy_cach_model_yeu_cau || "",
      r.brand || r.nhan_hieu || "",
      r.technical_params || r.thong_so_ky_thuat || "",
      r.unit || r.don_vi || "",
      r.quantity ?? r.so_luong ?? "",
      r.delivery_time || "",
      r.note || "",
      r.latest_clarification_title || ""
    ], "row"),
    textCols: [2],
    longTextCols: [3, 4, 6, 10, 11],
    leftAlignCols: [3, 4, 6, 11]
  },
  vt1_lam_ro_2: {
    headers: ["\u7F16\u53F7", "\u9700\u6C42\u8BA1\u5212\u7F16\u53F7", "\u7269\u8D44\u7F16\u7801", "\u7269\u8D44\u540D\u79F0", "\u56FE\u7247", "\u89C4\u683C\u578B\u53F7", "\u56FE\u53F7", "\u6750\u8D28", "\u539F\u8BBE\u5907\u5236\u9020\u5546\u751F\u4EA7\u5382", "\u662F\u5426\u4E13\u7528\u4EF6", "\u662F\u5426\u505C\u4EA7\u4EF6", "\u8BA2\u8D2D\u6570\u91CF", "\u8BA2\u8D2D\u5355\u4F4D", "\u6280\u672F\u53C2\u6570\u3001\u5B89\u88C5\u5C3A\u5BF8\u53CA\u7279\u6B8A\u8981\u6C42", "\u6295\u6807\u8BBE\u5907\u54C1\u724C/\u751F\u4EA7\u5382", "\u95EE\u9898", "\u56DE\u7B54"],
    row: /* @__PURE__ */ __name((r) => [
      r.stt_goc,
      r.ma_mua_sam,
      maVatTuExcel(r.ma_vat_tu),
      r.ten_vat_tu,
      "",
      r.required_model || r.quy_cach_model_yeu_cau || "",
      "",
      r.vat_lieu || "",
      r.brand || r.nhan_hieu || "",
      r.phu_tung_chuyen_dung || "",
      "",
      r.quantity ?? r.so_luong ?? "",
      r.unit || r.don_vi || "",
      r.yeu_cau_ky_thuat_bo_sung || "",
      r.technical_params || r.thong_so_ky_thuat || "",
      r.latest_clarification_title || "",
      ""
    ], "row"),
    textCols: [2],
    longTextCols: [3, 5, 13, 14, 15, 16],
    leftAlignCols: [3, 5, 13, 14, 15]
  },
  kq_muasamcong: {
    headers: ["STT", "Danh m\u1EE5c h\xE0ng h\xF3a", "K\xFD m\xE3 hi\u1EC7u", "Nh\xE3n hi\u1EC7u", "N\u0103m s\u1EA3n xu\u1EA5t", "Xu\u1EA5t x\u1EE9 (qu\u1ED1c gia, v\xF9ng l\xE3nh th\u1ED5 s\u1EA3n xu\u1EA5t)", "H\xE3ng s\u1EA3n xu\u1EA5t", "C\u1EA5u h\xECnh, t\xEDnh n\u0103ng k\u1EF9 thu\u1EADt c\u01A1 b\u1EA3n", "\u0110\u01A1n v\u1ECB t\xEDnh", "Kh\u1ED1i l\u01B0\u1EE3ng", "M\xE3 HS", "\u0110\u01A1n gi\xE1 tr\xFAng th\u1EA7u", "Th\xE0nh ti\u1EC1n \u0111\xE3 bao g\u1ED3m thu\u1EBF, ph\xED, l\u1EC7 ph\xED (n\u1EBFu c\xF3)", "Th\u1EDDi gian giao h\xE0ng (ng\xE0y)/ Ti\u1EBFn \u0111\u1ED9 cung c\u1EA5p"],
    row: /* @__PURE__ */ __name((r) => [
      r.stt_goc,
      r.ten_vat_tu,
      r.required_model || r.quy_cach_model_yeu_cau || "",
      r.brand || r.nhan_hieu || "",
      r.manufacture_year || r.nam_san_xuat || "",
      r.origin_country || r.xuat_xu || "",
      r.manufacturer || r.hang_goc_nsx_goc || "",
      r.technical_params || r.thong_so_ky_thuat || "",
      r.unit || r.don_vi || "",
      r.quantity ?? r.so_luong ?? "",
      "",
      r.don_gia_truoc_thue || r.don_gia_sau_thue || "",
      r.thanh_tien_sau_thue || "",
      r.delivery_time || ""
    ], "row"),
    textCols: [],
    longTextCols: [1, 2, 7],
    leftAlignCols: [1, 2, 7]
  },
  don_giao_hang: {
    headers: ["\u5E8F\u53F7\nSTT", "\u5408\u540C\u5E8F\u53F7\nSTT h\u1EE3p \u0111\u1ED3ng", "\u7269\u8D44\u7F16\u53F7\nM\xE3 v\u1EADt t\u01B0", "\u540D\u79F0\nT\xEAn v\u1EADt t\u01B0", "\u89C4\u683C\u578B\u53F7\nM\xE3 quy c\xE1ch", "\u6750\u8D28/\u54C1\u724C\nCh\u1EA5t li\u1EC7u/Th\u01B0\u01A1ng hi\u1EC7u", "\u6570\u91CF\nS\u1ED1 l\u01B0\u1EE3ng", "\u5355\u4F4D\n\u0110\u01A1n v\u1ECB", "\u539F\u8BBE\u5907\u4F9B\u8D27\u5546/\u751F\u4EA7\u5382/\u54C1\u724C\nNh\xE0 CC/NSX/Th\u01B0\u01A1ng hi\u1EC7u", "MIS\u9700\u6C42\u5355\u53F7\nM\xE3 y\xEAu c\u1EA7u MIS", "MIS\u8BA2\u5355\u53F7\nM\xE3 \u0111\u01A1n h\xE0ng MIS", "\u5907\u6CE8\nGhi ch\xFA"],
    row: /* @__PURE__ */ __name((r, i) => [
      i + 1,
      r.stt_goc || "",
      r.ma_vat_tu || "",
      r.ten_vat_tu || "",
      r.required_model || r.quy_cach_model_yeu_cau || "",
      r.vat_lieu || r.nhan_hieu || r.brand || "",
      r.quantity ?? r.so_luong ?? "",
      r.unit || r.don_vi || "",
      r.manufacturer || r.hang_goc_nsx_goc || r.nhan_hieu || r.brand || "",
      r.ma_mua_sam || "",
      "",
      r.note || ""
    ], "row"),
    textCols: [2],
    longTextCols: [3, 4, 5, 8, 11],
    leftAlignCols: [3, 4, 5, 8, 11]
  },
  don_tra_hang: {
    headers: ["\u5E8F\u53F7\nSTT", "\u5408\u540C\u5E8F\u53F7\nSTT h\u1EE3p \u0111\u1ED3ng", "\u7269\u8D44\u7F16\u53F7\nM\xE3 v\u1EADt t\u01B0", "\u540D\u79F0\nT\xEAn v\u1EADt t\u01B0", "\u89C4\u683C\u578B\u53F7\nM\xE3 quy c\xE1ch", "\u6750\u8D28/\u54C1\u724C\nCh\u1EA5t li\u1EC7u/Th\u01B0\u01A1ng hi\u1EC7u", "\u6570\u91CF\nS\u1ED1 l\u01B0\u1EE3ng", "\u5355\u4F4D\n\u0110\u01A1n v\u1ECB", "\u539F\u8BBE\u5907\u4F9B\u8D27\u5546/\u751F\u4EA7\u5382/\u54C1\u724C\nNh\xE0 CC/NSX/Th\u01B0\u01A1ng hi\u1EC7u", "MIS\u9700\u6C42\u5355\u53F7\nM\xE3 y\xEAu c\u1EA7u MIS", "MIS\u8BA2\u5355\u53F7\nM\xE3 \u0111\u01A1n h\xE0ng MIS", "\u5907\u6CE8\nGhi ch\xFA"],
    row: /* @__PURE__ */ __name((r, i) => [
      i + 1,
      r.stt_goc || "",
      r.ma_vat_tu || "",
      r.ten_vat_tu || "",
      r.required_model || r.quy_cach_model_yeu_cau || "",
      r.vat_lieu || r.nhan_hieu || r.brand || "",
      r.quantity ?? r.so_luong ?? "",
      r.unit || r.don_vi || "",
      r.manufacturer || r.hang_goc_nsx_goc || r.nhan_hieu || r.brand || "",
      r.ma_mua_sam || "",
      "",
      r.note || ""
    ], "row"),
    textCols: [2],
    longTextCols: [3, 4, 5, 8, 11],
    leftAlignCols: [3, 4, 5, 8, 11]
  }
};
function csvQ(value) {
  const s = String(value == null ? "" : value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
__name(csvQ, "csvQ");
function buildExportCsv(rows, opts) {
  const template = opts && opts.template || "chung";
  const colMask = opts && opts.colMask || [];
  const prefix = prefaceCsvLines(rows);
  if (template !== "chung" && EXPORT_TEMPLATES[template]) {
    const tpl = EXPORT_TEMPLATES[template];
    const lines2 = [...prefix, tpl.headers.map(csvQ).join(",")];
    for (const [i, r] of rows.entries()) lines2.push(tpl.row(r, i).map(csvQ).join(","));
    return "\uFEFF" + lines2.join("\r\n") + "\r\n";
  }
  const headers = EXPORT_COL_HEADERS;
  const indices = colMask.length ? colMask.map((c) => headers.indexOf(c)).filter((i) => i >= 0) : headers.map((_, i) => i);
  const activeIndices = indices.length ? indices : headers.map((_, i) => i);
  const filteredHeaders = activeIndices.map((i) => headers[i]);
  const lines = [...prefix, filteredHeaders.map(csvQ).join(",")];
  for (const r of rows) {
    const vals = rowToExportCsv(r);
    lines.push(activeIndices.map((i) => csvQ(vals[i])).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
__name(buildExportCsv, "buildExportCsv");
async function exportItems(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const VALID_TECH_FILTERS = /* @__PURE__ */ new Set(["has_clarification", "no_clarification", "khong_can", "dang_hoi", "da_xac_nhan", "bi_tu_choi"]);
  const VALID_TEMPLATES = /* @__PURE__ */ new Set(["chung", "vt1_lam_ro_1", "vt1_lam_ro_2", "kq_muasamcong"]);
  const rawTemplate = cleanString(p.exportTemplate || "chung", 40);
  const template = VALID_TEMPLATES.has(rawTemplate) ? rawTemplate : "chung";
  const rawIds = Array.isArray(p.selectedIds) ? p.selectedIds : [];
  const selectedIds = rawIds.map((s) => cleanString(String(s), 80)).filter(Boolean).slice(0, 500);
  const rawCols = template === "chung" && Array.isArray(p.cols) ? p.cols : [];
  const colMask = rawCols.map((s) => cleanString(String(s), 120)).filter(Boolean);
  const rows = await exportRfqItemsSQL(env.DB, {
    q: normalizeText(p.q),
    q2: normalizeText(p.q2),
    q3: normalizeText(p.q3),
    rfqId: p.rfqId || p.rfq_id || "",
    status: p.status || "",
    techFilter: VALID_TECH_FILTERS.has(p.techFilter) ? p.techFilter : "",
    sortBy: p.sortBy || "",
    sortDir: p.sortDir || "",
    selectedIds
  });
  const rfqId = cleanString(p.rfqId || p.rfq_id || "all", 80);
  const today = nowIso().slice(0, 10);
  const tplSuffix = template === "chung" ? "" : "-" + template.replace(/_/g, "-");
  return json({
    ok: true,
    filename: `rfq-items${tplSuffix}-${rfqId}-${today}.csv`,
    csv: buildExportCsv(rows, { template, colMask }),
    row_count: rows.length,
    capped: rows.length >= EXPORT_MAX_ROWS
  });
}
__name(exportItems, "exportItems");
function rawMaVatTu(v2) {
  if (typeof v2 === "string" && v2.startsWith('="') && v2.endsWith('"')) {
    return v2.slice(2, -1).replace(/""/g, '"');
  }
  return v2;
}
__name(rawMaVatTu, "rawMaVatTu");
var CHUNG_LONG_HEADERS = /* @__PURE__ */ new Set([
  "T\xEAn g\xF3i",
  "T\xEAn v\u1EADt t\u01B0 / Danh m\u1EE5c h\xE0ng h\xF3a",
  "K\xFD m\xE3 hi\u1EC7u / Model",
  "Quy c\xE1ch / th\xF4ng s\u1ED1 k\u1EF9 thu\u1EADt",
  "Y\xEAu c\u1EA7u k\u1EF9 thu\u1EADt b\u1ED5 sung",
  "Ghi ch\xFA",
  "L\xE0m r\xF5"
]);
var CHUNG_LEFT_ALIGN_HEADERS = /* @__PURE__ */ new Set([
  "T\xEAn v\u1EADt t\u01B0 / Danh m\u1EE5c h\xE0ng h\xF3a",
  "K\xFD m\xE3 hi\u1EC7u / Model",
  "Quy c\xE1ch / th\xF4ng s\u1ED1 k\u1EF9 thu\u1EADt",
  "Y\xEAu c\u1EA7u k\u1EF9 thu\u1EADt b\u1ED5 sung",
  "L\xE0m r\xF5"
]);
function buildExportPreface(rows) {
  if (!rows.length) return ["", "", ""];
  const keys = new Set(rows.map((r2) => r2.rfq_id || r2.ma_goi_tbmt || "").filter(Boolean));
  if (keys.size !== 1) return ["", "", ""];
  const key = [...keys][0];
  const r = rows.find((x) => (x.rfq_id || x.ma_goi_tbmt || "") === key) || rows[0];
  return [r.ma_goi_tbmt || "", r.ten_goi || "", r.ten_cdt || ""];
}
__name(buildExportPreface, "buildExportPreface");
function prefaceCsvLines(rows) {
  return buildExportPreface(rows).map(csvQ);
}
__name(prefaceCsvLines, "prefaceCsvLines");
function buildExportJson(rows, opts) {
  const template = opts && opts.template || "chung";
  const colMask = opts && opts.colMask || [];
  const preface = buildExportPreface(rows);
  if (template !== "chung" && EXPORT_TEMPLATES[template]) {
    const tpl = EXPORT_TEMPLATES[template];
    return {
      headers: tpl.headers,
      rows: rows.map((r, i) => tpl.row(r, i).map(rawMaVatTu)),
      textCols: tpl.textCols,
      longTextCols: tpl.longTextCols,
      leftAlignCols: tpl.leftAlignCols,
      preface
    };
  }
  const allHeaders = EXPORT_COL_HEADERS;
  const indices = colMask.length ? colMask.map((c) => allHeaders.indexOf(c)).filter((i) => i >= 0) : allHeaders.map((_, i) => i);
  const activeIndices = indices.length ? indices : allHeaders.map((_, i) => i);
  const headers = activeIndices.map((i) => allHeaders[i]);
  return {
    headers,
    rows: rows.map((r) => {
      const vals = rowToExportCsv(r);
      return activeIndices.map((i) => rawMaVatTu(vals[i]));
    }),
    textCols: headers.reduce((acc, h, i) => {
      if (h === "M\xE3 v\u1EADt t\u01B0") acc.push(i);
      return acc;
    }, []),
    longTextCols: headers.reduce((acc, h, i) => {
      if (CHUNG_LONG_HEADERS.has(h)) acc.push(i);
      return acc;
    }, []),
    leftAlignCols: headers.reduce((acc, h, i) => {
      if (CHUNG_LEFT_ALIGN_HEADERS.has(h)) acc.push(i);
      return acc;
    }, []),
    preface
  };
}
__name(buildExportJson, "buildExportJson");
async function exportItemsJson(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const VALID_TECH_FILTERS = /* @__PURE__ */ new Set(["has_clarification", "no_clarification", "khong_can", "dang_hoi", "da_xac_nhan", "bi_tu_choi"]);
  const VALID_TEMPLATES = /* @__PURE__ */ new Set(["chung", "vt1_lam_ro_1", "vt1_lam_ro_2", "kq_muasamcong", "don_giao_hang", "don_tra_hang"]);
  const rawTemplate = cleanString(p.exportTemplate || "chung", 40);
  const template = VALID_TEMPLATES.has(rawTemplate) ? rawTemplate : "chung";
  const rawIds = Array.isArray(p.selectedIds) ? p.selectedIds : [];
  const selectedIds = rawIds.map((s) => cleanString(String(s), 80)).filter(Boolean).slice(0, 500);
  const rawCols = template === "chung" && Array.isArray(p.cols) ? p.cols : [];
  const colMask = rawCols.map((s) => cleanString(String(s), 120)).filter(Boolean);
  const rows = await exportRfqItemsSQL(env.DB, {
    q: normalizeText(p.q),
    q2: normalizeText(p.q2),
    q3: normalizeText(p.q3),
    rfqId: p.rfqId || p.rfq_id || "",
    status: p.status || "",
    techFilter: VALID_TECH_FILTERS.has(p.techFilter) ? p.techFilter : "",
    sortBy: p.sortBy || "",
    sortDir: p.sortDir || "",
    selectedIds
  });
  const rfqId = cleanString(p.rfqId || p.rfq_id || "all", 80);
  const today = nowIso().slice(0, 10);
  const tplSuffix = template === "chung" ? "" : "-" + template.replace(/_/g, "-");
  const { headers, rows: dataRows, textCols, longTextCols, leftAlignCols, preface } = buildExportJson(rows, { template, colMask });
  return json({
    ok: true,
    filename: `rfq-items${tplSuffix}-${rfqId}-${today}.xlsx`,
    templateKey: template,
    headers,
    rows: dataRows,
    preface: preface || ["", "", ""],
    textCols: textCols || [],
    longTextCols: longTextCols || [],
    leftAlignCols: leftAlignCols || [],
    row_count: rows.length,
    capped: rows.length >= EXPORT_MAX_ROWS
  });
}
__name(exportItemsJson, "exportItemsJson");
async function hardDeleteAll(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqId = cleanString(body.rfqId || body.rfq_id, 80);
  if (!rfqId) return json({ ok: false, error: "Thieu rfqId" }, 400);
  const rfq = await getRfqSQL(env.DB, rfqId);
  if (!rfq) return json({ ok: false, error: "RFQ khong ton tai" }, 404);
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM rfq_items WHERE rfq_id = ?").bind(rfqId).first();
  const totalCount = countRow?.n || 0;
  if (!totalCount) return json({ ok: true, deleted: 0 });
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM technical_clarifications WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
    env.DB.prepare(`DELETE FROM supplier_quotes WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
    env.DB.prepare(`DELETE FROM pricing_decisions WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
    env.DB.prepare(`DELETE FROM contract_items WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
    env.DB.prepare(`DELETE FROM rfq_item_revisions WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
    env.DB.prepare(`UPDATE import_job_rows SET rfq_item_id = NULL WHERE rfq_item_id IN (SELECT rfq_item_id FROM rfq_items WHERE rfq_id = ?)`).bind(rfqId),
    env.DB.prepare(`DELETE FROM rfq_items WHERE rfq_id = ?`).bind(rfqId)
  ]);
  ctx.waitUntil(invalidateKv(env, ["dashboard:v1", "dashboard:v2"]));
  ctx.waitUntil(writeActionLog(env, { action: "hardDeleteAllRfqItems", entityType: "rfq", entityId: rfqId, actor }));
  return json({ ok: true, deleted: totalCount });
}
__name(hardDeleteAll, "hardDeleteAll");

// src/worker/db/supplier-queries.js
function parseCursor6(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf("|||");
  return idx === -1 ? { pk: cursor, sortVal: void 0 } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}
__name(parseCursor6, "parseCursor");
var SUPPLIER_SORT = {
  supplier_id: { col: "supplier_id", rowKey: "supplier_id", type: "text" },
  supplier_name: { col: "supplier_name", rowKey: "supplier_name", type: "text" },
  supplier_type: { col: "supplier_type", rowKey: "supplier_type", type: "text" },
  country: { col: "country", rowKey: "country", type: "text" }
};
async function listSuppliersSQL(db, { q, cursor, sortBy, sortDir, limit }) {
  const sort = SUPPLIER_SORT[sortBy] || null;
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const op = dir === "ASC" ? ">" : "<";
  const binds = [];
  const where = ["deleted_at IS NULL"];
  if (q) {
    where.push("(normalized_search LIKE ? OR supplier_name LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (cursor) {
    const c = parseCursor6(cursor);
    if (!sort || c.sortVal === void 0) {
      where.push("supplier_id > ?");
      binds.push(c.pk);
    } else {
      const wrap = `COALESCE(${sort.col}, '')`;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND supplier_id ${op} ?))`);
      binds.push(c.sortVal, c.sortVal, c.pk);
    }
  }
  const orderBy = sort ? `${sort.col} ${dir}, supplier_id ${dir}` : "supplier_id ASC";
  const res = await db.prepare(
    `SELECT * FROM suppliers ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = sort ? String(last[sort.rowKey] ?? "") + "|||" + last.supplier_id : last.supplier_id;
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor };
}
__name(listSuppliersSQL, "listSuppliersSQL");
async function archiveSupplierSQL(db, supplierId, now) {
  return db.prepare("UPDATE suppliers SET deleted_at = ? WHERE supplier_id = ?").bind(now, supplierId).run();
}
__name(archiveSupplierSQL, "archiveSupplierSQL");
async function getSupplierSQL(db, id) {
  return db.prepare("SELECT * FROM suppliers WHERE supplier_id = ?").bind(id).first();
}
__name(getSupplierSQL, "getSupplierSQL");
async function insertSupplierSQL(db, row) {
  return db.prepare(
    `INSERT INTO suppliers (supplier_id, supplier_name, supplier_type, country, tax_code, contact_name, email, phone, zalo, wechat, note, normalized_search, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.supplier_id, row.supplier_name, row.supplier_type, row.country, row.tax_code, row.contact_name, row.email, row.phone, row.zalo, row.wechat, row.note, row.normalized_search, row.created_at, row.updated_at).run();
}
__name(insertSupplierSQL, "insertSupplierSQL");
async function updateSupplierSQL(db, row) {
  return db.prepare(
    `UPDATE suppliers SET supplier_name = ?, supplier_type = ?, country = ?, tax_code = ?, contact_name = ?, email = ?, phone = ?,
       zalo = ?, wechat = ?, note = ?, normalized_search = ?, updated_at = ?
     WHERE supplier_id = ?`
  ).bind(row.supplier_name, row.supplier_type, row.country, row.tax_code, row.contact_name, row.email, row.phone, row.zalo, row.wechat, row.note, row.normalized_search, row.updated_at, row.supplier_id).run();
}
__name(updateSupplierSQL, "updateSupplierSQL");

// src/worker/handlers/suppliers.js
async function handleSuppliers(action, request, env, ctx, actor) {
  if (action === "getSuppliers") return listSuppliers(request, env, actor);
  if (action === "createSupplier") return saveSupplier(request, env, ctx, actor, false);
  if (action === "updateSupplier") return saveSupplier(request, env, ctx, actor, true);
  if (action === "archiveSupplier") return archiveSupplier(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown supplier action" }, 400);
}
__name(handleSuppliers, "handleSuppliers");
async function listSuppliers(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const data = await listSuppliersSQL(env.DB, { q: normalizeText(p.q), cursor: p.cursor || "", sortBy: p.sortBy || "", sortDir: p.sortDir || "", limit: clampLimit(p.limit) });
  return json({ ok: true, ...data });
}
__name(listSuppliers, "listSuppliers");
async function archiveSupplier(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const supplierId = cleanString(body.supplierId || body.supplier_id, 80);
  if (!supplierId) return json({ ok: false, error: "Thieu ma nha cung cap" }, 400);
  const row = await getSupplierSQL(env.DB, supplierId);
  if (!row) return json({ ok: false, error: "Khong tim thay nha cung cap" }, 404);
  const now = nowIso();
  await archiveSupplierSQL(env.DB, supplierId, now);
  ctx.waitUntil(writeActionLog(env, { action: "archiveSupplier", entityType: "supplier", entityId: supplierId, oldJson: row, newJson: null, actor }));
  return json({ ok: true });
}
__name(archiveSupplier, "archiveSupplier");
async function saveSupplier(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const name = cleanString(body.supplierName || body.supplier_name, 180);
  if (!name) return json({ ok: false, error: "Ten nha cung cap la bat buoc" }, 400);
  const now = nowIso();
  const oldRow = isUpdate ? await getSupplierSQL(env.DB, body.supplierId || body.supplier_id) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: "Khong tim thay supplier" }, 404);
  const row = {
    supplier_id: isUpdate ? oldRow.supplier_id : await nextEntityId(env.DB, "suppliers", "supplier_id", "SUP"),
    supplier_name: name,
    supplier_type: cleanString(body.supplierType || body.supplier_type || "unknown", 40),
    country: cleanString(body.country, 80),
    tax_code: cleanString(body.taxCode || body.tax_code, 80),
    contact_name: cleanString(body.contactName || body.contact_name, 120),
    email: cleanString(body.email, 160),
    phone: cleanString(body.phone, 60),
    zalo: cleanString(body.zalo, 80),
    wechat: cleanString(body.wechat, 80),
    note: cleanString(body.note, 1e3),
    normalized_search: buildSearchText([name, body.taxCode || body.tax_code, body.country, body.contactName, body.phone, body.email]),
    created_at: oldRow?.created_at || now,
    updated_at: now
  };
  if (isUpdate) await updateSupplierSQL(env.DB, row);
  else await insertSupplierSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, { action: isUpdate ? "updateSupplier" : "createSupplier", entityType: "supplier", entityId: row.supplier_id, oldJson: oldRow, newJson: row, actor }));
  return json({ ok: true, supplier: row });
}
__name(saveSupplier, "saveSupplier");

// src/worker/db/pricing-decision-queries.js
async function listPricingDecisionsSQL(db, rfqItemId) {
  const res = await db.prepare(
    `SELECT pd.*,
            sq.supplier_name AS supplier_name,
            sq.manufacturer  AS manufacturer,
            sq.status        AS quote_status
     FROM pricing_decisions pd
     LEFT JOIN supplier_quotes sq ON sq.quote_id = pd.base_quote_id
     WHERE pd.rfq_item_id = ?
     ORDER BY pd.version DESC`
  ).bind(rfqItemId).all();
  return res.results || [];
}
__name(listPricingDecisionsSQL, "listPricingDecisionsSQL");
async function getNextPricingVersionSQL(db, rfqItemId) {
  const row = await db.prepare(
    `SELECT MAX(version) AS max_version FROM pricing_decisions WHERE rfq_item_id = ?`
  ).bind(rfqItemId).first();
  return (row && row.max_version ? Number(row.max_version) : 0) + 1;
}
__name(getNextPricingVersionSQL, "getNextPricingVersionSQL");
async function insertPricingDecisionSQL(db, row) {
  return db.prepare(
    `INSERT INTO pricing_decisions (
      pricing_id, rfq_item_id, base_quote_id,
      base_price_vnd_incl_tax, markup_rate, selection_reason,
      risk_level, risk_note,
      proposed_unit_price, proposed_line_total,
      pricing_note, version, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.pricing_id,
    row.rfq_item_id,
    row.base_quote_id,
    row.base_price_vnd_incl_tax,
    row.markup_rate,
    row.selection_reason,
    row.risk_level,
    row.risk_note,
    row.proposed_unit_price,
    row.proposed_line_total,
    row.pricing_note,
    row.version,
    row.created_by,
    row.created_at
  ).run();
}
__name(insertPricingDecisionSQL, "insertPricingDecisionSQL");

// src/worker/db/supplier-quote-queries.js
var SQ_SORT = {
  created_at: { col: "sq.created_at", rowKey: "created_at", type: "text" },
  supplier_name: { col: "sq.supplier_name", rowKey: "supplier_name", type: "text" },
  manufacturer: { col: "sq.manufacturer", rowKey: "manufacturer", type: "text" },
  price: { col: "sq.price_vnd_incl_tax", rowKey: "price_vnd_incl_tax", type: "num" },
  valid_until: { col: "sq.valid_until", rowKey: "valid_until", type: "text" },
  quote_date: { col: "sq.quote_date", rowKey: "quote_date", type: "text" }
};
async function listSupplierQuotesSQL(db, rfqItemId) {
  const res = await db.prepare(
    `SELECT * FROM supplier_quotes
     WHERE rfq_item_id = ?
     ORDER BY created_at ASC`
  ).bind(rfqItemId).all();
  return res.results || [];
}
__name(listSupplierQuotesSQL, "listSupplierQuotesSQL");
async function getSupplierQuoteSQL(db, quoteId) {
  return db.prepare(
    `SELECT * FROM supplier_quotes WHERE quote_id = ?`
  ).bind(quoteId).first();
}
__name(getSupplierQuoteSQL, "getSupplierQuoteSQL");
async function insertSupplierQuoteSQL(db, row) {
  return db.prepare(
    `INSERT INTO supplier_quotes (
      quote_id, rfq_item_id, supplier_id, supplier_name, manufacturer, quote_date,
      quoted_price, currency, exchange_rate, price_vnd, tax_rate, price_vnd_incl_tax,
      lead_time, valid_until, warranty, note, source_channel, source_ref, received_at,
      status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.quote_id,
    row.rfq_item_id,
    row.supplier_id,
    row.supplier_name,
    row.manufacturer,
    row.quote_date,
    row.quoted_price,
    row.currency,
    row.exchange_rate,
    row.price_vnd,
    row.tax_rate,
    row.price_vnd_incl_tax,
    row.lead_time,
    row.valid_until,
    row.warranty,
    row.note,
    row.source_channel,
    row.source_ref,
    row.received_at,
    row.status,
    row.created_by,
    row.created_at,
    row.updated_at
  ).run();
}
__name(insertSupplierQuoteSQL, "insertSupplierQuoteSQL");
async function updateSupplierQuoteSQL(db, row) {
  return db.prepare(
    `UPDATE supplier_quotes SET
      supplier_id = ?, supplier_name = ?, manufacturer = ?, quote_date = ?,
      quoted_price = ?, currency = ?, exchange_rate = ?, price_vnd = ?, tax_rate = ?,
      price_vnd_incl_tax = ?, lead_time = ?, valid_until = ?, warranty = ?, note = ?,
      source_channel = ?, source_ref = ?, received_at = ?, updated_at = ?
     WHERE quote_id = ? AND status = 'active'`
  ).bind(
    row.supplier_id,
    row.supplier_name,
    row.manufacturer,
    row.quote_date,
    row.quoted_price,
    row.currency,
    row.exchange_rate,
    row.price_vnd,
    row.tax_rate,
    row.price_vnd_incl_tax,
    row.lead_time,
    row.valid_until,
    row.warranty,
    row.note,
    row.source_channel,
    row.source_ref,
    row.received_at,
    row.updated_at,
    row.quote_id
  ).run();
}
__name(updateSupplierQuoteSQL, "updateSupplierQuoteSQL");
async function archiveSupplierQuoteSQL(db, { quoteId, updatedAt }) {
  return db.prepare(
    `UPDATE supplier_quotes SET status = 'archived', updated_at = ?
     WHERE quote_id = ? AND status = 'active'`
  ).bind(updatedAt, quoteId).run();
}
__name(archiveSupplierQuoteSQL, "archiveSupplierQuoteSQL");
async function deleteSupplierQuoteSQL(db, quoteId) {
  return db.prepare(
    `DELETE FROM supplier_quotes WHERE quote_id = ?`
  ).bind(quoteId).run();
}
__name(deleteSupplierQuoteSQL, "deleteSupplierQuoteSQL");
async function getExpiredQuotesReportSQL(db, today) {
  const [countRow, samplesRes] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS n FROM supplier_quotes
       WHERE status = 'active'
         AND valid_until IS NOT NULL AND valid_until != ''
         AND valid_until < ?`
    ).bind(today).first(),
    db.prepare(
      `SELECT quote_id, rfq_item_id, supplier_name, valid_until
       FROM supplier_quotes
       WHERE status = 'active'
         AND valid_until IS NOT NULL AND valid_until != ''
         AND valid_until < ?
       ORDER BY valid_until ASC LIMIT 10`
    ).bind(today).all()
  ]);
  return { count: countRow?.n || 0, samples: samplesRes.results || [] };
}
__name(getExpiredQuotesReportSQL, "getExpiredQuotesReportSQL");
async function searchSupplierQuotesSQL(db, params) {
  const {
    q,
    supplierName,
    manufacturer,
    status,
    sourceChannel,
    priceMin,
    priceMax,
    validUntilFrom,
    validUntilTo,
    rfqId,
    rfqItemId,
    sortBy,
    sortDir,
    cursorSortVal,
    cursorQuoteId,
    limit
  } = params;
  const sort = SQ_SORT[sortBy] || SQ_SORT.created_at;
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const op = dir === "ASC" ? ">" : "<";
  const conds = [];
  const binds = [];
  if (rfqItemId) {
    conds.push("sq.rfq_item_id = ?");
    binds.push(rfqItemId);
  }
  if (rfqId) {
    conds.push("i.rfq_id = ?");
    binds.push(rfqId);
  }
  if (status) {
    conds.push("sq.status = ?");
    binds.push(status);
  }
  if (sourceChannel) {
    conds.push("sq.source_channel = ?");
    binds.push(sourceChannel);
  }
  if (supplierName) {
    conds.push("sq.supplier_name LIKE ?");
    binds.push("%" + supplierName + "%");
  }
  if (manufacturer) {
    conds.push("sq.manufacturer LIKE ?");
    binds.push("%" + manufacturer + "%");
  }
  if (priceMin !== null && priceMin !== void 0) {
    conds.push("sq.price_vnd_incl_tax >= ?");
    binds.push(priceMin);
  }
  if (priceMax !== null && priceMax !== void 0) {
    conds.push("sq.price_vnd_incl_tax <= ?");
    binds.push(priceMax);
  }
  if (validUntilFrom) {
    conds.push("sq.valid_until >= ?");
    binds.push(validUntilFrom);
  }
  if (validUntilTo) {
    conds.push("sq.valid_until <= ?");
    binds.push(validUntilTo);
  }
  if (q) {
    const like = "%" + q + "%";
    conds.push("(sq.supplier_name LIKE ? OR sq.manufacturer LIKE ? OR sq.source_ref LIKE ? OR i.ten_vat_tu LIKE ? OR i.ma_vat_tu LIKE ? OR i.required_model LIKE ? OR i.quy_cach_model_yeu_cau LIKE ? OR r.ma_goi_tbmt LIKE ? OR r.ten_goi LIKE ?)");
    binds.push(like, like, like, like, like, like, like, like, like);
  }
  if (cursorSortVal !== null && cursorSortVal !== void 0 && cursorQuoteId) {
    if (sort.type === "num") {
      const sv = Number(cursorSortVal);
      conds.push(`(COALESCE(${sort.col}, 0) ${op} ? OR (COALESCE(${sort.col}, 0) = ? AND sq.quote_id ${op} ?))`);
      binds.push(sv, sv, cursorQuoteId);
    } else {
      const sv = cursorSortVal;
      conds.push(`(COALESCE(${sort.col}, '') ${op} ? OR (COALESCE(${sort.col}, '') = ? AND sq.quote_id ${op} ?))`);
      binds.push(sv, sv, cursorQuoteId);
    }
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const orderBy = `${sort.col} ${dir}, sq.quote_id ${dir}`;
  const sql = `
    SELECT
      sq.quote_id, sq.rfq_item_id, sq.supplier_id, sq.supplier_name, sq.manufacturer,
      sq.quote_date, sq.quoted_price, sq.currency, sq.exchange_rate, sq.price_vnd,
      sq.tax_rate, sq.price_vnd_incl_tax, sq.lead_time, sq.valid_until, sq.warranty,
      sq.note, sq.source_channel, sq.source_ref, sq.received_at,
      sq.status, sq.created_at, sq.updated_at,
      i.rfq_id, i.ma_vat_tu, i.ten_vat_tu, i.required_model, i.quy_cach_model_yeu_cau,
      COALESCE(i.required_model, i.quy_cach_model_yeu_cau) AS required_model_display,
      r.ma_goi_tbmt, r.ten_goi, r.nha_may_cdt, r.ngay_het_han, r.trang_thai_goi
    FROM supplier_quotes sq
    JOIN rfq_items i ON i.rfq_item_id = sq.rfq_item_id
    JOIN rfqs r      ON r.rfq_id = i.rfq_id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ?
  `;
  binds.push(limit);
  const res = await db.prepare(sql).bind(...binds).all();
  return { rows: res.results || [], sort, dir };
}
__name(searchSupplierQuotesSQL, "searchSupplierQuotesSQL");

// src/worker/handlers/pricing-decisions.js
var VALID_SELECTION_REASONS = /* @__PURE__ */ new Set([
  "lowest_price",
  "better_lead_time",
  "better_warranty",
  "preferred_brand",
  "client_approved",
  "available_stock",
  "other"
]);
var VALID_RISK_LEVELS = /* @__PURE__ */ new Set(["low", "medium", "high"]);
async function handlePricingDecisions(action, request, env, ctx, actor) {
  const body = await readJson(request);
  if (action === "getPricingDecisions") {
    const roleCheck = requireRole(actor, WRITE_ROLES);
    if (roleCheck) return roleCheck;
    const rfqItemId = cleanString(body.rfqItemId, 200);
    if (!rfqItemId) return json({ ok: false, error: "rfqItemId required" }, 400);
    const rows = await listPricingDecisionsSQL(env.DB, rfqItemId);
    return json({ ok: true, rows });
  }
  if (action === "createPricingDecision") {
    const roleCheck = requireRole(actor, MANAGE_ROLES);
    if (roleCheck) return roleCheck;
    const rfqItemId = cleanString(body.rfqItemId, 200);
    const baseQuoteId = cleanString(body.baseQuoteId, 200);
    if (!rfqItemId) return json({ ok: false, error: "rfqItemId required" }, 400);
    if (!baseQuoteId) return json({ ok: false, error: "baseQuoteId required" }, 400);
    const [quote, item] = await Promise.all([
      getSupplierQuoteSQL(env.DB, baseQuoteId),
      getRfqItemSQL(env.DB, rfqItemId)
    ]);
    if (!quote) return json({ ok: false, error: "Bao gia khong ton tai" }, 400);
    if (quote.status !== "active") return json({ ok: false, error: "Chi co the chon bao gia dang active" }, 400);
    if (quote.rfq_item_id !== rfqItemId) return json({ ok: false, error: "Bao gia khong thuoc dong vat tu nay" }, 400);
    if (!item) return json({ ok: false, error: "RFQ item khong ton tai" }, 400);
    const selectionReason = cleanString(body.selectionReason, 100);
    if (selectionReason && !VALID_SELECTION_REASONS.has(selectionReason)) {
      return json({ ok: false, error: "selectionReason khong hop le" }, 400);
    }
    const pricingNote = cleanString(body.pricingNote, 2e3);
    if (selectionReason === "other" && !pricingNote) {
      return json({ ok: false, error: 'pricingNote bat buoc khi ly do la "other"' }, 400);
    }
    const riskLevel = cleanString(body.riskLevel, 50);
    if (riskLevel && !VALID_RISK_LEVELS.has(riskLevel)) {
      return json({ ok: false, error: "riskLevel khong hop le" }, 400);
    }
    const rawMarkup = cleanNumber(body.markupRate);
    const markupRate = rawMarkup < 1 ? 1 : rawMarkup > 9.99 ? 9.99 : rawMarkup;
    const basePriceVndInclTax = Number(quote.price_vnd_incl_tax) || 0;
    const proposedUnitPrice = Math.round(basePriceVndInclTax * markupRate);
    const quantity = cleanNumber(item.quantity ?? item.so_luong);
    const proposedLineTotal = Math.round(proposedUnitPrice * quantity);
    const version = await getNextPricingVersionSQL(env.DB, rfqItemId);
    const pricingId = makeId("PDC");
    const createdAt = nowIso();
    const createdBy = actor?.id || "";
    const row = {
      pricing_id: pricingId,
      rfq_item_id: rfqItemId,
      base_quote_id: baseQuoteId,
      base_price_vnd_incl_tax: basePriceVndInclTax,
      markup_rate: markupRate,
      selection_reason: selectionReason || null,
      risk_level: riskLevel || null,
      risk_note: cleanString(body.riskNote, 1e3) || null,
      proposed_unit_price: proposedUnitPrice,
      proposed_line_total: proposedLineTotal,
      pricing_note: pricingNote || null,
      version,
      created_by: createdBy,
      created_at: createdAt
    };
    await insertPricingDecisionSQL(env.DB, row);
    const actorName = publicActorName(actor);
    ctx.waitUntil(writeActionLog(env, {
      action: "createPricingDecision",
      entityType: "pricing_decision",
      entityId: pricingId,
      oldJson: null,
      newJson: row,
      actor,
      message: actorName + " tao can gia v" + version + " cho " + rfqItemId + ": base " + baseQuoteId + ", markup x" + markupRate + ", de xuat " + proposedUnitPrice + " VND"
    }));
    return json({ ok: true, pricingDecision: row });
  }
  return json({ ok: false, error: "Unknown action" }, 400);
}
__name(handlePricingDecisions, "handlePricingDecisions");

// src/worker/handlers/supplier-quotes.js
var VALID_CURRENCY = /* @__PURE__ */ new Set(["VND", "USD", "EUR", "JPY", "CNY", "SGD", "KRW"]);
var VALID_SOURCE_CHANNEL = /* @__PURE__ */ new Set(["", "zalo", "wechat", "email", "phone", "direct", "other"]);
async function handleSupplierQuotes(action, request, env, ctx, actor) {
  if (action === "getSupplierQuotes") return listQuotes(request, env, actor);
  if (action === "searchSupplierQuotes") return searchQuotes(request, env, actor);
  if (action === "createSupplierQuote") return saveQuote(request, env, ctx, actor, false);
  if (action === "updateSupplierQuote") return saveQuote(request, env, ctx, actor, true);
  if (action === "archiveSupplierQuote") return archiveQuote(request, env, ctx, actor);
  if (action === "deleteSupplierQuote") return deleteQuote(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown supplier quote action" }, 400);
}
__name(handleSupplierQuotes, "handleSupplierQuotes");
async function listQuotes(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id, 80);
  if (!rfqItemId) return json({ ok: false, error: "Thieu ma dong vat tu" }, 400);
  const rows = await listSupplierQuotesSQL(env.DB, rfqItemId);
  return json({ ok: true, rows });
}
__name(listQuotes, "listQuotes");
async function searchQuotes(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rawLimit = cleanNumber(body.limit);
  const limit = rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50;
  const status = cleanString(body.status || "", 20);
  if (status && status !== "active" && status !== "archived") {
    return json({ ok: false, error: "status phai la active, archived, hoac de trong" }, 400);
  }
  const sourceChannel = normalizeSourceChannel(body.sourceChannel ?? body.source_channel);
  if (sourceChannel === null) {
    return json({ ok: false, error: "sourceChannel khong hop le" }, 400);
  }
  const validUntilFrom = cleanString(body.validUntilFrom || "", 20);
  const validUntilTo = cleanString(body.validUntilTo || "", 20);
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (validUntilFrom && !dateRe.test(validUntilFrom)) {
    return json({ ok: false, error: "validUntilFrom phai la YYYY-MM-DD" }, 400);
  }
  if (validUntilTo && !dateRe.test(validUntilTo)) {
    return json({ ok: false, error: "validUntilTo phai la YYYY-MM-DD" }, 400);
  }
  const priceMinRaw = body.priceMin !== void 0 && body.priceMin !== "" ? cleanNumber(body.priceMin) : null;
  const priceMaxRaw = body.priceMax !== void 0 && body.priceMax !== "" ? cleanNumber(body.priceMax) : null;
  let cursorSortVal = null;
  let cursorQuoteId = null;
  const cursorRaw = cleanString(body.cursor || "", 200);
  if (cursorRaw) {
    const sep = cursorRaw.indexOf("|||");
    if (sep !== -1) {
      cursorSortVal = cursorRaw.slice(0, sep);
      cursorQuoteId = cursorRaw.slice(sep + 3);
    }
  }
  const sortBy = cleanString(body.sortBy || "", 40);
  const sortDir = body.sortDir === "asc" ? "asc" : "desc";
  const params = {
    q: cleanString(body.q || "", 200),
    supplierName: cleanString(body.supplierName || "", 180),
    manufacturer: cleanString(body.manufacturer || "", 180),
    status,
    sourceChannel,
    priceMin: priceMinRaw,
    priceMax: priceMaxRaw,
    validUntilFrom,
    validUntilTo,
    rfqId: cleanString(body.rfqId || "", 80),
    rfqItemId: cleanString(body.rfqItemId || "", 80),
    sortBy,
    sortDir,
    cursorSortVal,
    cursorQuoteId,
    limit: limit + 1
  };
  const result = await searchSupplierQuotesSQL(env.DB, params);
  const all = result.rows;
  const hasMore = all.length > limit;
  const rows = hasMore ? all.slice(0, limit) : all;
  let nextCursor = null;
  if (hasMore && rows.length > 0) {
    const last = rows[rows.length - 1];
    const sortRowKey = result.sort ? result.sort.rowKey : "created_at";
    nextCursor = String(last[sortRowKey] ?? "") + "|||" + last.quote_id;
  }
  return json({ ok: true, rows, hasMore, nextCursor });
}
__name(searchQuotes, "searchQuotes");
async function saveQuote(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();
  const quoteId = isUpdate ? cleanString(body.quoteId || body.quote_id, 80) : null;
  const oldRow = isUpdate ? await getSupplierQuoteSQL(env.DB, quoteId) : null;
  if (isUpdate && (!oldRow || oldRow.status !== "active")) {
    return json({ ok: false, error: "Khong tim thay bao gia hoac da luu tru" }, 404);
  }
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id || oldRow && oldRow.rfq_item_id || "", 80);
  const item = await getRfqItemSQL(env.DB, rfqItemId);
  if (!item) return json({ ok: false, error: "Khong tim thay dong vat tu" }, 404);
  if (normalizeSourceChannel(body.sourceChannel ?? body.source_channel) === null) {
    return json({ ok: false, error: "sourceChannel khong hop le" }, 400);
  }
  const row = normalizeQuote(body, {
    quote_id: isUpdate ? oldRow.quote_id : makeId("QUO"),
    rfq_item_id: rfqItemId,
    status: "active",
    created_by: isUpdate ? oldRow.created_by : actor.id,
    created_at: isUpdate ? oldRow.created_at : now,
    updated_at: isUpdate ? now : null
  });
  if (isUpdate) await updateSupplierQuoteSQL(env.DB, row);
  else await insertSupplierQuoteSQL(env.DB, row);
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? "updateSupplierQuote" : "createSupplierQuote",
    entityType: "supplier_quote",
    entityId: row.quote_id,
    oldJson: oldRow,
    newJson: row,
    actor
  }));
  return json({ ok: true, quote: row });
}
__name(saveQuote, "saveQuote");
async function archiveQuote(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const quoteId = cleanString(body.quoteId || body.quote_id, 80);
  if (!quoteId) return json({ ok: false, error: "Thieu ma bao gia" }, 400);
  const oldRow = await getSupplierQuoteSQL(env.DB, quoteId);
  if (!oldRow || oldRow.status !== "active") {
    return json({ ok: false, error: "Khong tim thay bao gia hoac da luu tru" }, 404);
  }
  const now = nowIso();
  await archiveSupplierQuoteSQL(env.DB, { quoteId, updatedAt: now });
  ctx.waitUntil(writeActionLog(env, {
    action: "archiveSupplierQuote",
    entityType: "supplier_quote",
    entityId: quoteId,
    oldJson: oldRow,
    newJson: { ...oldRow, status: "archived", updated_at: now },
    actor
  }));
  return json({ ok: true });
}
__name(archiveQuote, "archiveQuote");
async function deleteQuote(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const quoteId = cleanString(body.quoteId || body.quote_id, 80);
  if (!quoteId) return json({ ok: false, error: "Thieu ma bao gia" }, 400);
  const oldRow = await getSupplierQuoteSQL(env.DB, quoteId);
  if (!oldRow) return json({ ok: false, error: "Khong tim thay bao gia" }, 404);
  await deleteSupplierQuoteSQL(env.DB, quoteId);
  ctx.waitUntil(writeActionLog(env, {
    action: "deleteSupplierQuote",
    entityType: "supplier_quote",
    entityId: quoteId,
    oldJson: oldRow,
    newJson: null,
    actor
  }));
  ctx.waitUntil(cleanupQuoteMedia(env, quoteId));
  return json({ ok: true });
}
__name(deleteQuote, "deleteQuote");
async function cleanupQuoteMedia(env, quoteId) {
  try {
    const files = await getMediaKeysByOwnerSQL(env.DB, "quote", quoteId);
    if (!files.length) return;
    await Promise.allSettled(
      files.filter((f) => f && f.r2_key).map((f) => env.MEDIA?.delete(f.r2_key))
    );
    await deleteMediaFilesByOwnerSQL(env.DB, "quote", quoteId);
    console.log(`[cleanup] quote ${quoteId}: removed ${files.length} media file(s)`);
  } catch (err) {
    console.error(`[cleanup] quote ${quoteId} media cleanup failed:`, err);
  }
}
__name(cleanupQuoteMedia, "cleanupQuoteMedia");
function normalizeQuote(body, base) {
  const quotedPrice = cleanNumber(body.quotedPrice ?? body.quoted_price);
  const exchangeRate = cleanNumber(body.exchangeRate ?? body.exchange_rate) || 1;
  const taxRate = cleanNumber(body.taxRate ?? body.tax_rate);
  const rawCurrency = cleanString(body.currency || "VND", 10).toUpperCase();
  const currency = VALID_CURRENCY.has(rawCurrency) ? rawCurrency : "VND";
  const priceVnd = Math.round(quotedPrice * exchangeRate);
  const priceVndInclTax = Math.round(priceVnd * (1 + taxRate / 100));
  const supplierId = cleanString(body.supplierId ?? body.supplier_id, 80);
  const sourceChannel = normalizeSourceChannel(body.sourceChannel ?? body.source_channel);
  const receivedAt = normalizeReceivedAt(body.receivedAt ?? body.received_at);
  return {
    ...base,
    supplier_id: supplierId || null,
    supplier_name: cleanString(body.supplierName ?? body.supplier_name, 180),
    manufacturer: cleanString(body.manufacturer, 180),
    quote_date: cleanString(body.quoteDate ?? body.quote_date, 20),
    quoted_price: quotedPrice,
    currency,
    exchange_rate: exchangeRate,
    price_vnd: priceVnd,
    tax_rate: taxRate,
    price_vnd_incl_tax: priceVndInclTax,
    lead_time: cleanString(body.leadTime ?? body.lead_time, 120),
    valid_until: cleanString(body.validUntil ?? body.valid_until, 20),
    warranty: cleanString(body.warranty, 240),
    note: cleanString(body.note, 2e3),
    source_channel: sourceChannel || null,
    source_ref: cleanString(body.sourceRef ?? body.source_ref, 1e3),
    received_at: receivedAt
  };
}
__name(normalizeQuote, "normalizeQuote");
function normalizeSourceChannel(value) {
  const channel = cleanString(value || "", 20).toLowerCase();
  return VALID_SOURCE_CHANNEL.has(channel) ? channel : null;
}
__name(normalizeSourceChannel, "normalizeSourceChannel");
function normalizeReceivedAt(value) {
  const raw = cleanString(value || "", 40);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;
  return "";
}
__name(normalizeReceivedAt, "normalizeReceivedAt");

// src/worker/db/technical-clarification-queries.js
async function listTechnicalClarificationsSQL(db, rfqItemId) {
  const res = await db.prepare(
    `SELECT tc.*, mf.file_name AS attachment_file_name
     FROM technical_clarifications tc
     LEFT JOIN media_files mf ON mf.file_id = tc.attachment_file_id
     WHERE tc.rfq_item_id = ? AND tc.deleted_at IS NULL
     ORDER BY tc.created_at DESC, tc.sequence_no DESC`
  ).bind(rfqItemId).all();
  return res.results || [];
}
__name(listTechnicalClarificationsSQL, "listTechnicalClarificationsSQL");
async function getTechnicalClarificationSQL(db, clarificationId) {
  return db.prepare(
    `SELECT * FROM technical_clarifications WHERE clarification_id = ?`
  ).bind(clarificationId).first();
}
__name(getTechnicalClarificationSQL, "getTechnicalClarificationSQL");
async function nextClarificationId(db) {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1e3);
  const yyyy = d.toISOString().slice(0, 4);
  const mmdd = d.toISOString().slice(5, 10).replace("-", "");
  const prefix = `Cla-${yyyy}-${mmdd}`;
  const row = await db.prepare(
    `SELECT clarification_id FROM technical_clarifications WHERE clarification_id LIKE ? ORDER BY clarification_id DESC LIMIT 1`
  ).bind(`${prefix}-%`).first();
  const last = row?.clarification_id ? Number(row.clarification_id.split("-").pop()) : 0;
  const seq = (Number.isFinite(last) ? last : 0) + 1;
  return `${prefix}-${String(seq).padStart(2, "0")}`;
}
__name(nextClarificationId, "nextClarificationId");
async function nextClarificationSequenceSQL(db, rfqItemId) {
  const row = await db.prepare(
    `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence
     FROM technical_clarifications
     WHERE rfq_item_id = ?`
  ).bind(rfqItemId).first();
  return Number(row?.next_sequence || 1);
}
__name(nextClarificationSequenceSQL, "nextClarificationSequenceSQL");
async function insertTechnicalClarificationSQL(db, row) {
  return db.prepare(
    `INSERT INTO technical_clarifications (
      clarification_id, rfq_item_id, sequence_no, clarification_type, title, content,
      old_model, proposed_model, proposed_manufacturer, proposed_origin, status_after,
      attachment_file_id, created_by, created_at, updated_at, deleted_at, raw_note, external_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.clarification_id,
    row.rfq_item_id,
    row.sequence_no,
    row.clarification_type,
    row.title,
    row.content,
    row.old_model,
    row.proposed_model,
    row.proposed_manufacturer,
    row.proposed_origin,
    row.status_after,
    row.attachment_file_id,
    row.created_by,
    row.created_at,
    row.updated_at,
    row.deleted_at,
    row.raw_note,
    row.external_url || null
  ).run();
}
__name(insertTechnicalClarificationSQL, "insertTechnicalClarificationSQL");
async function updateTechnicalClarificationSQL(db, row) {
  return db.prepare(
    `UPDATE technical_clarifications SET
      clarification_type = ?, title = ?, content = ?, old_model = ?, proposed_model = ?,
      proposed_manufacturer = ?, proposed_origin = ?, status_after = ?, attachment_file_id = ?,
      updated_at = ?, raw_note = ?, external_url = ?
     WHERE clarification_id = ? AND deleted_at IS NULL`
  ).bind(
    row.clarification_type,
    row.title,
    row.content,
    row.old_model,
    row.proposed_model,
    row.proposed_manufacturer,
    row.proposed_origin,
    row.status_after,
    row.attachment_file_id,
    row.updated_at,
    row.raw_note,
    row.external_url || null,
    row.clarification_id
  ).run();
}
__name(updateTechnicalClarificationSQL, "updateTechnicalClarificationSQL");
async function quickUpdateClarificationSQL(db, clarificationId, clarificationType, statusAfter, now) {
  return db.prepare(
    "UPDATE technical_clarifications SET clarification_type = ?, status_after = ?, updated_at = ? WHERE clarification_id = ? AND deleted_at IS NULL"
  ).bind(clarificationType, statusAfter, now, clarificationId).run();
}
__name(quickUpdateClarificationSQL, "quickUpdateClarificationSQL");
async function softDeleteTechnicalClarificationSQL(db, { clarificationId, deletedAt }) {
  return db.prepare(
    `UPDATE technical_clarifications SET deleted_at = ?, updated_at = ?
     WHERE clarification_id = ? AND deleted_at IS NULL`
  ).bind(deletedAt, deletedAt, clarificationId).run();
}
__name(softDeleteTechnicalClarificationSQL, "softDeleteTechnicalClarificationSQL");

// src/worker/db/rfq-item-revision-queries.js
async function listRfqItemRevisionsSQL(db, rfqItemId) {
  const res = await db.prepare(
    `SELECT r.*,
       tc.title AS clarification_title,
       u.display_name AS created_by_name
     FROM rfq_item_revisions r
     LEFT JOIN technical_clarifications tc ON tc.clarification_id = r.source_clarification_id
     LEFT JOIN users u ON u.user_id = r.created_by
     WHERE r.rfq_item_id = ?
     ORDER BY r.revision_no ASC`
  ).bind(rfqItemId).all();
  return res.results || [];
}
__name(listRfqItemRevisionsSQL, "listRfqItemRevisionsSQL");
function insertRevisionStmt(db, rev) {
  return db.prepare(
    `INSERT INTO rfq_item_revisions (
      revision_id, rfq_item_id, revision_no, source_clarification_id,
      ma_mua_sam, ma_vat_tu, ten_vat_tu,
      required_model, manufacturer, brand, origin_country, technical_params, note,
      quy_cach_final, hang_final, xuat_xu_final, trang_thai_ky_thuat,
      created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    rev.revision_id,
    rev.rfq_item_id,
    rev.revision_no,
    rev.source_clarification_id ?? null,
    rev.ma_mua_sam ?? null,
    rev.ma_vat_tu ?? null,
    rev.ten_vat_tu ?? null,
    rev.required_model ?? null,
    rev.manufacturer ?? null,
    rev.brand ?? null,
    rev.origin_country ?? null,
    rev.technical_params ?? null,
    rev.note ?? null,
    rev.quy_cach_final ?? null,
    rev.hang_final ?? null,
    rev.xuat_xu_final ?? null,
    rev.trang_thai_ky_thuat ?? null,
    rev.created_at,
    rev.created_by ?? null
  );
}
__name(insertRevisionStmt, "insertRevisionStmt");
function snapshotFromItem(item) {
  return {
    ma_mua_sam: item.ma_mua_sam ?? null,
    ma_vat_tu: item.ma_vat_tu ?? null,
    ten_vat_tu: item.ten_vat_tu ?? null,
    required_model: item.required_model ?? null,
    manufacturer: item.manufacturer ?? null,
    brand: item.brand ?? null,
    origin_country: item.origin_country ?? null,
    technical_params: item.technical_params ?? null,
    note: item.note ?? null,
    quy_cach_final: item.quy_cach_final ?? null,
    hang_final: item.hang_final ?? null,
    xuat_xu_final: item.xuat_xu_final ?? null,
    trang_thai_ky_thuat: item.trang_thai_ky_thuat ?? null
  };
}
__name(snapshotFromItem, "snapshotFromItem");

// src/worker/handlers/technical-clarifications.js
var CLARIFICATION_TYPES = /* @__PURE__ */ new Set([
  "ask_supplier",
  // Hỏi hãng
  "supplier_opinion",
  // HSX ý kiến
  "supplier_reply",
  // HSX phản hồi
  "ask_client",
  // CĐT ý kiến
  "client_reply",
  // CĐT phản hồi
  "replacement_proposal",
  "final_confirm",
  // Final confirm — triggers revision when confirmRevision=true
  "rejected",
  // Từ chối
  "other"
  // Khác
]);
var STATUS_AFTER = /* @__PURE__ */ new Set([
  "processing",
  // Đang xử lý
  "waiting_supplier",
  // Đang hỏi hãng
  "waiting_client",
  // Đang chờ CĐT
  "need_more_info",
  // Cần bổ sung
  "final_confirmed",
  // Đã xác nhận — triggers revision when confirmRevision=true
  "rejected",
  // Bị từ chối
  "other"
  // Khác
]);
var TECH_STATUS_MAP = {
  waiting_supplier: "dang_hoi",
  waiting_client: "dang_hoi",
  need_more_info: "can_bo_sung",
  final_confirmed: "da_xac_nhan",
  rejected: "bi_tu_choi"
};
async function handleTechnicalClarifications(action, request, env, ctx, actor) {
  if (action === "getTechnicalClarifications") return listClarifications(request, env, actor);
  if (action === "getItemRevisions") return listRevisions(request, env, actor);
  if (action === "createTechnicalClarification") return saveClarification(request, env, ctx, actor, false);
  if (action === "updateTechnicalClarification") return saveClarification(request, env, ctx, actor, true);
  if (action === "deleteTechnicalClarification") return deleteClarification(request, env, ctx, actor);
  if (action === "quickUpdateClarification") return quickUpdateClar(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown technical clarification action" }, 400);
}
__name(handleTechnicalClarifications, "handleTechnicalClarifications");
async function listClarifications(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id, 80);
  if (!rfqItemId) return json({ ok: false, error: "Thieu ma dong vat tu" }, 400);
  const rows = await listTechnicalClarificationsSQL(env.DB, rfqItemId);
  return json({ ok: true, rows });
}
__name(listClarifications, "listClarifications");
async function listRevisions(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id, 80);
  if (!rfqItemId) return json({ ok: false, error: "Thieu ma dong vat tu" }, 400);
  const rows = await listRfqItemRevisionsSQL(env.DB, rfqItemId);
  return json({ ok: true, rows });
}
__name(listRevisions, "listRevisions");
async function saveClarification(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, isUpdate ? MANAGE_ROLES : WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();
  const clarificationId = cleanString(body.clarificationId || body.clarification_id, 80);
  const oldRow = isUpdate ? await getTechnicalClarificationSQL(env.DB, clarificationId) : null;
  if (isUpdate && (!oldRow || oldRow.deleted_at)) return json({ ok: false, error: "Khong tim thay trao doi ky thuat" }, 404);
  if (isUpdate) {
    const linked = await env.DB.prepare(
      `SELECT 1 FROM rfq_item_revisions WHERE source_clarification_id = ? LIMIT 1`
    ).bind(clarificationId).first();
    if (linked) {
      if (!isEvidenceOnlyUpdate(body, oldRow)) {
        return json({ ok: false, error: "Trao doi nay da tao lich su thay doi quy cach va khong the chinh sua" }, 409);
      }
      const evUrl = cleanUrl3(body.externalUrl || body.external_url);
      const evFileId = cleanString(body.attachmentFileId || body.attachment_file_id, 120) || null;
      const evNow = nowIso();
      await env.DB.prepare(
        `UPDATE technical_clarifications SET external_url = ?, attachment_file_id = ?, updated_at = ? WHERE clarification_id = ? AND deleted_at IS NULL`
      ).bind(evUrl || null, evFileId, evNow, clarificationId).run();
      ctx.waitUntil(writeActionLog(env, {
        action: "updateTechnicalClarificationEvidence",
        entityType: "technical_clarification",
        entityId: clarificationId,
        message: `C\u1EADp nh\u1EADt URL/b\u1EB1ng ch\u1EE9ng trao \u0111\u1ED5i k\u1EF9 thu\u1EADt \u2014 ${clarificationId}`,
        oldJson: { external_url: oldRow.external_url, attachment_file_id: oldRow.attachment_file_id },
        newJson: { external_url: evUrl || null, attachment_file_id: evFileId },
        actor
      }));
      return json({ ok: true, clarification: { ...oldRow, external_url: evUrl || null, attachment_file_id: evFileId, updated_at: evNow } });
    }
  }
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id || oldRow?.rfq_item_id, 80);
  const item = await getRfqItemSQL(env.DB, rfqItemId);
  if (!item) return json({ ok: false, error: "Khong tim thay dong vat tu" }, 404);
  let row;
  try {
    row = normalizeClarification(body, {
      clarification_id: isUpdate ? oldRow.clarification_id : await nextClarificationId(env.DB),
      rfq_item_id: rfqItemId,
      sequence_no: isUpdate ? oldRow.sequence_no : await nextClarificationSequenceSQL(env.DB, rfqItemId),
      created_by: isUpdate ? oldRow.created_by : actor.id,
      created_at: isUpdate ? oldRow.created_at : now,
      updated_at: isUpdate ? now : null,
      deleted_at: null
    });
  } catch (err) {
    return json({ ok: false, error: err.message || "Du lieu trao doi ky thuat khong hop le" }, 400);
  }
  if (isUpdate) await updateTechnicalClarificationSQL(env.DB, row);
  else await insertTechnicalClarificationSQL(env.DB, row);
  const confirmRevision = body.confirmRevision === true || body.confirmRevision === "true";
  if (shouldCreateRevision(row, confirmRevision)) {
    await applyRevisionBatch(env.DB, { item, clarificationRow: row, now, actorId: actor.id });
  }
  ctx.waitUntil(invalidateKv(env, ["dashboard:v1"]));
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? "updateTechnicalClarification" : "createTechnicalClarification",
    entityType: "technical_clarification",
    entityId: row.clarification_id,
    message: isUpdate ? `C\u1EADp nh\u1EADt trao \u0111\u1ED5i k\u1EF9 thu\u1EADt [${row.clarification_type}] \u2014 v\u1EADt t\u01B0 ${rfqItemId}` : `Trao \u0111\u1ED5i k\u1EF9 thu\u1EADt m\u1EDBi [${row.clarification_type}] \u2014 v\u1EADt t\u01B0 ${rfqItemId}`,
    oldJson: oldRow,
    newJson: row,
    actor
  }));
  return json({ ok: true, clarification: row });
}
__name(saveClarification, "saveClarification");
async function quickUpdateClar(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const clarId = cleanString(body.clarificationId || body.clarification_id, 80);
  if (!clarId) return json({ ok: false, error: "Thi\u1EBFu clarification_id" }, 400);
  const newType = cleanString(body.clarificationType || body.clarification_type, 50) || null;
  const newStatus = cleanString(body.statusAfter || body.status_after, 50) || null;
  if (newType && !CLARIFICATION_TYPES.has(newType)) return json({ ok: false, error: "Lo\u1EA1i l\xE0m r\xF5 kh\xF4ng h\u1EE3p l\u1EC7" }, 400);
  if (newStatus && !STATUS_AFTER.has(newStatus)) return json({ ok: false, error: "Tr\u1EA1ng th\xE1i kh\xF4ng h\u1EE3p l\u1EC7" }, 400);
  const existing = await getTechnicalClarificationSQL(env.DB, clarId);
  if (!existing || existing.deleted_at) return json({ ok: false, error: "Kh\xF4ng t\xECm th\u1EA5y trao \u0111\u1ED5i k\u1EF9 thu\u1EADt" }, 404);
  const finalType = newType || existing.clarification_type;
  const finalStatus = newStatus || existing.status_after;
  const now = nowIso();
  await quickUpdateClarificationSQL(env.DB, clarId, finalType, finalStatus, now);
  await invalidateKv(env, ["dashboard:v2"]);
  ctx.waitUntil(writeActionLog(env, {
    action: "quickUpdateClarification",
    entityType: "technical_clarification",
    entityId: clarId,
    message: `C\u1EADp nh\u1EADt nhanh trao \u0111\u1ED5i [${finalType}/${finalStatus}] \u2014 ${clarId}`,
    oldJson: { clarification_type: existing.clarification_type, status_after: existing.status_after },
    newJson: { clarification_type: finalType, status_after: finalStatus },
    actor
  }));
  return json({ ok: true });
}
__name(quickUpdateClar, "quickUpdateClar");
async function deleteClarification(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const clarificationId = cleanString(body.clarificationId || body.clarification_id, 80);
  const oldRow = await getTechnicalClarificationSQL(env.DB, clarificationId);
  if (!oldRow || oldRow.deleted_at) return json({ ok: false, error: "Khong tim thay trao doi ky thuat" }, 404);
  const linkedRev = await env.DB.prepare(
    `SELECT 1 FROM rfq_item_revisions WHERE source_clarification_id = ? LIMIT 1`
  ).bind(clarificationId).first();
  if (linkedRev) return json({ ok: false, error: "Trao doi nay da tao lich su thay doi quy cach va khong the xoa" }, 409);
  const now = nowIso();
  await softDeleteTechnicalClarificationSQL(env.DB, { clarificationId, deletedAt: now });
  ctx.waitUntil(writeActionLog(env, {
    action: "deleteTechnicalClarification",
    entityType: "technical_clarification",
    entityId: clarificationId,
    message: `X\xF3a trao \u0111\u1ED5i k\u1EF9 thu\u1EADt [${oldRow.clarification_type}] \u2014 v\u1EADt t\u01B0 ${oldRow.rfq_item_id}`,
    oldJson: oldRow,
    newJson: { ...oldRow, deleted_at: now },
    actor
  }));
  return json({ ok: true });
}
__name(deleteClarification, "deleteClarification");
function shouldCreateRevision(row, confirmRevision) {
  return confirmRevision === true && (row.clarification_type === "final_confirm" || row.status_after === "final_confirmed");
}
__name(shouldCreateRevision, "shouldCreateRevision");
async function applyRevisionBatch(db, { item, clarificationRow, now, actorId }) {
  const currentRevNo = Number(item.current_revision_no || 0);
  const newRevNo = currentRevNo + 1;
  const finalModel = clarificationRow.proposed_model || item.quy_cach_final || null;
  const finalManufacturer = clarificationRow.proposed_manufacturer || item.hang_final || null;
  const finalOrigin = clarificationRow.proposed_origin || item.xuat_xu_final || null;
  const finalStatus = mappedTechnicalStatus(clarificationRow);
  const stmts = [];
  if (currentRevNo === 0) {
    stmts.push(insertRevisionStmt(db, {
      revision_id: makeId("RIR"),
      rfq_item_id: item.rfq_item_id,
      revision_no: 0,
      source_clarification_id: null,
      ...snapshotFromItem(item),
      created_at: now,
      created_by: actorId
    }));
  }
  stmts.push(db.prepare(
    `UPDATE rfq_items
     SET quy_cach_final = ?, hang_final = ?, xuat_xu_final = ?,
         trang_thai_ky_thuat = ?, current_revision_no = ?, updated_at = ?
     WHERE rfq_item_id = ?`
  ).bind(finalModel, finalManufacturer, finalOrigin, finalStatus, newRevNo, now, item.rfq_item_id));
  stmts.push(insertRevisionStmt(db, {
    revision_id: makeId("RIR"),
    rfq_item_id: item.rfq_item_id,
    revision_no: newRevNo,
    source_clarification_id: clarificationRow.clarification_id,
    ...snapshotFromItem(item),
    // override with the new final values
    quy_cach_final: finalModel,
    hang_final: finalManufacturer,
    xuat_xu_final: finalOrigin,
    trang_thai_ky_thuat: finalStatus,
    created_at: now,
    created_by: actorId
  }));
  await db.batch(stmts);
}
__name(applyRevisionBatch, "applyRevisionBatch");
function cleanUrl3(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return "";
  return s.slice(0, 2e3);
}
__name(cleanUrl3, "cleanUrl");
function normalizeClarification(body, base) {
  const clarificationType = cleanString(body.clarificationType || body.clarification_type, 40);
  const statusAfter = cleanString(body.statusAfter || body.status_after, 40);
  const title = cleanString(body.title, 240);
  if (!CLARIFICATION_TYPES.has(clarificationType)) throw new Error("Loai trao doi ky thuat khong hop le");
  if (statusAfter && !STATUS_AFTER.has(statusAfter)) throw new Error("Trang thai sau trao doi khong hop le");
  if (!title) throw new Error("Tieu de trao doi la bat buoc");
  return {
    ...base,
    clarification_type: clarificationType,
    title,
    content: cleanString(body.content, 3e3),
    old_model: cleanString(body.oldModel || body.old_model, 1e3),
    proposed_model: cleanString(body.proposedModel || body.proposed_model, 1e3),
    proposed_manufacturer: cleanString(body.proposedManufacturer || body.proposed_manufacturer, 180),
    proposed_origin: cleanString(body.proposedOrigin || body.proposed_origin, 120),
    status_after: statusAfter,
    attachment_file_id: cleanString(body.attachmentFileId || body.attachment_file_id, 120),
    raw_note: cleanString(body.rawNote || body.raw_note, 2e3),
    external_url: cleanUrl3(body.externalUrl || body.external_url)
  };
}
__name(normalizeClarification, "normalizeClarification");
function mappedTechnicalStatus(row) {
  const status = row.clarification_type === "final_confirm" ? "final_confirmed" : row.status_after;
  return TECH_STATUS_MAP[status] || "da_xac_nhan";
}
__name(mappedTechnicalStatus, "mappedTechnicalStatus");
function isEvidenceOnlyUpdate(body, oldRow) {
  if (body.confirmRevision === true || body.confirmRevision === "true") return false;
  const c = /* @__PURE__ */ __name((s, max) => cleanString(s ?? "", max), "c");
  const checks = [
    [c(body.clarificationType || body.clarification_type, 40), c(oldRow.clarification_type, 40)],
    [c(body.title, 240), c(oldRow.title, 240)],
    [c(body.content, 3e3), c(oldRow.content, 3e3)],
    [c(body.oldModel || body.old_model, 1e3), c(oldRow.old_model, 1e3)],
    [c(body.proposedModel || body.proposed_model, 1e3), c(oldRow.proposed_model, 1e3)],
    [c(body.proposedManufacturer || body.proposed_manufacturer, 180), c(oldRow.proposed_manufacturer, 180)],
    [c(body.proposedOrigin || body.proposed_origin, 120), c(oldRow.proposed_origin, 120)],
    [c(body.statusAfter || body.status_after, 40), c(oldRow.status_after, 40)],
    [c(body.rawNote || body.raw_note, 2e3), c(oldRow.raw_note, 2e3)]
  ];
  for (const [fromBody, fromRow] of checks) {
    if (fromBody !== fromRow) return false;
  }
  return true;
}
__name(isEvidenceOnlyUpdate, "isEvidenceOnlyUpdate");

// src/worker/db/price-history-queries.js
var SORT_EXPR = "COALESCE(sq.received_at, sq.quote_date, sq.created_at)";
var SELECT_COLS = `
  sq.quote_id, sq.rfq_item_id, i.item_id,
  it.ma_vat_tu          AS master_ma_vat_tu,
  it.ten_vat_tu         AS master_ten_vat_tu,
  it.required_model     AS master_spec,
  i.ma_vat_tu, i.ten_vat_tu,
  COALESCE(i.required_model, i.quy_cach_model_yeu_cau) AS required_model,
  i.manufacturer,
  COALESCE(i.brand, i.nhan_hieu)              AS brand,
  COALESCE(i.origin_country, i.xuat_xu)       AS origin_country,
  COALESCE(i.unit, i.don_vi)                  AS unit,
  COALESCE(i.quantity, i.so_luong)            AS quantity,
  i.rfq_id,
  r.ma_goi_tbmt, r.ten_goi, r.nha_may_cdt, r.client_id,
  sq.supplier_id, sq.supplier_name,
  sq.quote_date, sq.received_at,
  sq.source_channel, sq.source_ref,
  sq.quoted_price, sq.currency, sq.exchange_rate,
  sq.price_vnd, sq.tax_rate, sq.price_vnd_incl_tax,
  sq.lead_time, sq.valid_until, sq.warranty,
  sq.note, sq.status, sq.created_at,
  ${SORT_EXPR} AS sort_date,
  (
    SELECT COUNT(*) FROM media_files mf
    WHERE mf.owner_type = 'quote' AND mf.owner_id = sq.quote_id
  ) AS evidence_count
`.trim();
var FROM_JOINS = `
  FROM supplier_quotes sq
  JOIN rfq_items i  ON i.rfq_item_id = sq.rfq_item_id
  JOIN rfqs r       ON r.rfq_id = i.rfq_id
  LEFT JOIN items it ON it.item_id = i.item_id
`.trim();
function buildFilters(p) {
  const conds = [];
  const binds = [];
  if (p.rfqItemId) {
    conds.push("sq.rfq_item_id = ?");
    binds.push(p.rfqItemId);
  }
  if (p.itemId) {
    conds.push("i.item_id = ?");
    binds.push(p.itemId);
  }
  if (p.rfqId) {
    conds.push("i.rfq_id = ?");
    binds.push(p.rfqId);
  }
  if (p.clientId) {
    conds.push("r.client_id = ?");
    binds.push(p.clientId);
  }
  if (p.supplierId) {
    conds.push("sq.supplier_id = ?");
    binds.push(p.supplierId);
  }
  if (p.supplierName) {
    conds.push("sq.supplier_name LIKE ?");
    binds.push("%" + p.supplierName + "%");
  }
  if (p.sourceChannel) {
    conds.push("sq.source_channel = ?");
    binds.push(p.sourceChannel);
  }
  if (p.maVatTu) {
    conds.push("(i.ma_vat_tu LIKE ? OR it.ma_vat_tu LIKE ?)");
    binds.push("%" + p.maVatTu + "%", "%" + p.maVatTu + "%");
  }
  if (p.dateFrom) {
    conds.push(`${SORT_EXPR} >= ?`);
    binds.push(p.dateFrom);
  }
  if (p.dateTo) {
    conds.push(`${SORT_EXPR} <= ?`);
    binds.push(p.dateTo);
  }
  if (p.q) {
    const like = "%" + p.q + "%";
    conds.push(
      "(sq.supplier_name LIKE ? OR i.ten_vat_tu LIKE ? OR i.ma_vat_tu LIKE ? OR COALESCE(i.required_model, i.quy_cach_model_yeu_cau) LIKE ? OR r.ma_goi_tbmt LIKE ? OR r.ten_goi LIKE ? OR it.ma_vat_tu LIKE ? OR it.ten_vat_tu LIKE ?)"
    );
    binds.push(like, like, like, like, like, like, like, like);
  }
  if (p.cursorSortDate && p.cursorQuoteId) {
    conds.push(
      `(${SORT_EXPR} < ? OR (${SORT_EXPR} = ? AND sq.quote_id < ?))`
    );
    binds.push(p.cursorSortDate, p.cursorSortDate, p.cursorQuoteId);
  }
  return { conds, binds };
}
__name(buildFilters, "buildFilters");
async function searchPriceHistorySQL(db, params) {
  const { conds, binds } = buildFilters(params);
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const sql = `SELECT ${SELECT_COLS} ${FROM_JOINS} ${where}
    ORDER BY sort_date DESC, sq.quote_id DESC LIMIT ?`;
  const res = await db.prepare(sql).bind(...binds, params.limit).all();
  return res.results || [];
}
__name(searchPriceHistorySQL, "searchPriceHistorySQL");
async function getPriceHistorySummarySQL(db, filters) {
  const { conds, binds } = buildFilters(filters);
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const aggSql = `
    SELECT
      COUNT(*)                                          AS total_quotes,
      COUNT(DISTINCT COALESCE(sq.supplier_id, sq.supplier_name)) AS supplier_count,
      COUNT(DISTINCT i.rfq_id)                         AS rfq_count,
      COUNT(DISTINCT sq.rfq_item_id)                   AS item_count,
      MIN(sq.price_vnd_incl_tax)                       AS min_price_vnd_incl_tax,
      MAX(sq.price_vnd_incl_tax)                       AS max_price_vnd_incl_tax,
      AVG(sq.price_vnd_incl_tax)                       AS avg_price_vnd_incl_tax
    ${FROM_JOINS} ${where}
  `;
  const latestSql = `
    SELECT
      sq.price_vnd_incl_tax AS latest_price_vnd_incl_tax,
      ${SORT_EXPR}          AS latest_quote_date,
      sq.supplier_name      AS latest_supplier_name
    ${FROM_JOINS} ${where}
    ORDER BY ${SORT_EXPR} DESC, sq.quote_id DESC
    LIMIT 1
  `;
  const [aggRes, latestRes] = await Promise.all([
    db.prepare(aggSql).bind(...binds).first(),
    db.prepare(latestSql).bind(...binds).first()
  ]);
  return {
    total_quotes: aggRes?.total_quotes ?? 0,
    supplier_count: aggRes?.supplier_count ?? 0,
    rfq_count: aggRes?.rfq_count ?? 0,
    item_count: aggRes?.item_count ?? 0,
    min_price_vnd_incl_tax: aggRes?.min_price_vnd_incl_tax ?? null,
    max_price_vnd_incl_tax: aggRes?.max_price_vnd_incl_tax ?? null,
    avg_price_vnd_incl_tax: aggRes?.avg_price_vnd_incl_tax ?? null,
    latest_price_vnd_incl_tax: latestRes?.latest_price_vnd_incl_tax ?? null,
    latest_quote_date: latestRes?.latest_quote_date ?? null,
    latest_supplier_name: latestRes?.latest_supplier_name ?? null
  };
}
__name(getPriceHistorySummarySQL, "getPriceHistorySummarySQL");
async function exportPriceHistorySQL(db, filters) {
  const { conds, binds } = buildFilters(filters);
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const sql = `SELECT ${SELECT_COLS} ${FROM_JOINS} ${where}
    ORDER BY sort_date DESC, sq.quote_id DESC LIMIT ?`;
  const res = await db.prepare(sql).bind(...binds, filters.limit).all();
  return res.results || [];
}
__name(exportPriceHistorySQL, "exportPriceHistorySQL");

// src/worker/handlers/price-history.js
var VALID_SOURCE_CHANNEL2 = /* @__PURE__ */ new Set(["", "zalo", "wechat", "email", "phone", "direct", "other"]);
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var MAX_EXPORT_ROWS = 5e3;
async function handlePriceHistory(action, request, env, _ctx, actor) {
  if (action === "searchPriceHistory") return searchHistory(request, env, actor);
  if (action === "getPriceHistorySummary") return summaryHistory(request, env, actor);
  if (action === "exportPriceHistoryCsv") return exportHistoryCsv(request, env, actor);
  return json({ ok: false, error: "Unknown price history action" }, 400);
}
__name(handlePriceHistory, "handlePriceHistory");
async function searchHistory(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const limit = clampLimit(body.limit, 50, 200);
  const filters = parseFilters(body);
  const err = validateFilters(filters);
  if (err) return json({ ok: false, error: err }, 400);
  let cursorSortDate = null;
  let cursorQuoteId = null;
  const cursorRaw = cleanString(body.cursor || "", 200);
  if (cursorRaw) {
    const parts = cursorRaw.split("|");
    if (parts.length === 2 && parts[0] && parts[1]) {
      cursorSortDate = parts[0];
      cursorQuoteId = parts[1];
    }
  }
  const rows = await searchPriceHistorySQL(env.DB, {
    ...filters,
    cursorSortDate,
    cursorQuoteId,
    limit: limit + 1
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  let nextCursor = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = (last.sort_date || last.created_at) + "|" + last.quote_id;
  }
  return json({ ok: true, rows: page, hasMore, nextCursor });
}
__name(searchHistory, "searchHistory");
async function summaryHistory(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const filters = parseFilters(body);
  const err = validateFilters(filters);
  if (err) return json({ ok: false, error: err }, 400);
  const summary = await getPriceHistorySummarySQL(env.DB, filters);
  return json({ ok: true, summary });
}
__name(summaryHistory, "summaryHistory");
async function exportHistoryCsv(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const filters = parseFilters(body);
  const err = validateFilters(filters);
  if (err) return json({ ok: false, error: err }, 400);
  const rows = await exportPriceHistorySQL(env.DB, { ...filters, limit: MAX_EXPORT_ROWS });
  const csv = buildCsv(rows);
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const hint = filters.rfqItemId || filters.itemId || filters.rfqId || filters.maVatTu || "all";
  const safeHint = String(hint).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40);
  const filename = `price-history-${safeHint}-${today}.csv`;
  return json({ ok: true, filename, csv, row_count: rows.length });
}
__name(exportHistoryCsv, "exportHistoryCsv");
function parseFilters(body) {
  return {
    rfqItemId: cleanString(body.rfqItemId || body.rfq_item_id || "", 80),
    itemId: cleanString(body.itemId || body.item_id || "", 80),
    q: cleanString(body.q || "", 200),
    maVatTu: cleanString(body.maVatTu || body.ma_vat_tu || "", 80),
    supplierId: cleanString(body.supplierId || body.supplier_id || "", 80),
    supplierName: cleanString(body.supplierName || body.supplier_name || "", 180),
    rfqId: cleanString(body.rfqId || body.rfq_id || "", 80),
    clientId: cleanString(body.clientId || body.client_id || "", 80),
    sourceChannel: cleanString(body.sourceChannel || body.source_channel || "", 20).toLowerCase(),
    dateFrom: cleanString(body.dateFrom || body.date_from || "", 20),
    dateTo: cleanString(body.dateTo || body.date_to || "", 20)
  };
}
__name(parseFilters, "parseFilters");
function validateFilters(f) {
  if (f.sourceChannel && !VALID_SOURCE_CHANNEL2.has(f.sourceChannel)) {
    return "sourceChannel khong hop le";
  }
  if (f.dateFrom && !DATE_RE.test(f.dateFrom)) return "dateFrom phai la YYYY-MM-DD";
  if (f.dateTo && !DATE_RE.test(f.dateTo)) return "dateTo phai la YYYY-MM-DD";
  return null;
}
__name(validateFilters, "validateFilters");
function csvQuote(value) {
  const s = String(value == null ? "" : value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
__name(csvQuote, "csvQuote");
var CSV_HEADERS = [
  "M\xE3 b\xE1o gi\xE1",
  "M\xE3 d\xF2ng VT",
  "M\xE3 master item",
  "M\xE3 VT (master)",
  "T\xEAn VT (master)",
  "Quy c\xE1ch (master)",
  "M\xE3 VT",
  "T\xEAn VT",
  "Quy c\xE1ch/model",
  "H\xE3ng SX",
  "Nh\xE3n hi\u1EC7u",
  "Xu\u1EA5t x\u1EE9",
  "\u0110VT",
  "S\u1ED1 l\u01B0\u1EE3ng",
  "M\xE3 RFQ",
  "M\xE3 g\xF3i TBMT",
  "T\xEAn g\xF3i",
  "C\u0110T/Nh\xE0 m\xE1y",
  "Client ID",
  "NCC ID",
  "T\xEAn NCC",
  "Ng\xE0y b\xE1o gi\xE1",
  "Ng\xE0y nh\u1EADn",
  "K\xEAnh",
  "Tham chi\u1EBFu ngu\u1ED3n",
  "Gi\xE1 b\xE1o",
  "Ti\u1EC1n t\u1EC7",
  "T\u1EF7 gi\xE1",
  "Gi\xE1 VND",
  "Thu\u1EBF %",
  "Gi\xE1 VND+Thu\u1EBF",
  "Giao h\xE0ng",
  "Hi\u1EC7u l\u1EF1c \u0111\u1EBFn",
  "B\u1EA3o h\xE0nh",
  "Ghi ch\xFA",
  "Tr\u1EA1ng th\xE1i",
  "Ng\xE0y t\u1EA1o",
  "S\u1ED1 minh ch\u1EE9ng"
];
function rowToCsvValues(r) {
  return [
    r.quote_id,
    r.rfq_item_id,
    r.item_id || "",
    r.master_ma_vat_tu || "",
    r.master_ten_vat_tu || "",
    r.master_spec || "",
    r.ma_vat_tu || "",
    r.ten_vat_tu || "",
    r.required_model || "",
    r.manufacturer || "",
    r.brand || "",
    r.origin_country || "",
    r.unit || "",
    r.quantity ?? "",
    r.rfq_id || "",
    r.ma_goi_tbmt || "",
    r.ten_goi || "",
    r.nha_may_cdt || "",
    r.client_id || "",
    r.supplier_id || "",
    r.supplier_name || "",
    r.quote_date || "",
    r.received_at || "",
    r.source_channel || "",
    r.source_ref || "",
    r.quoted_price ?? 0,
    r.currency || "",
    r.exchange_rate ?? 1,
    r.price_vnd ?? 0,
    r.tax_rate ?? 0,
    r.price_vnd_incl_tax ?? 0,
    r.lead_time || "",
    r.valid_until || "",
    r.warranty || "",
    r.note || "",
    r.status || "",
    r.created_at || "",
    r.evidence_count ?? 0
  ];
}
__name(rowToCsvValues, "rowToCsvValues");
function buildCsv(rows) {
  const lines = [CSV_HEADERS.map(csvQuote).join(",")];
  for (const r of rows) {
    lines.push(rowToCsvValues(r).map(csvQuote).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
__name(buildCsv, "buildCsv");

// src/worker/db/contract-queries.js
var CONTRACT_SORT_EXPR = "COALESCE(c.signed_date, c.created_at)";
async function listContractsSQL(db, params) {
  const { q, rfqId, clientId, status, dateFrom, dateTo, cursorSortDate, cursorContractId, limit } = params;
  const conds = [];
  const binds = [];
  if (rfqId) {
    conds.push("c.rfq_id = ?");
    binds.push(rfqId);
  }
  if (clientId) {
    conds.push("c.client_id = ?");
    binds.push(clientId);
  }
  if (status) {
    conds.push("c.status = ?");
    binds.push(status);
  }
  if (dateFrom) {
    conds.push(`${CONTRACT_SORT_EXPR} >= ?`);
    binds.push(dateFrom);
  }
  if (dateTo) {
    conds.push(`${CONTRACT_SORT_EXPR} <= ?`);
    binds.push(dateTo);
  }
  if (q) {
    const like = "%" + q + "%";
    conds.push("(c.contract_no LIKE ? OR c.contract_name LIKE ? OR c.note LIKE ? OR cl.client_name LIKE ?)");
    binds.push(like, like, like, like);
  }
  if (cursorSortDate && cursorContractId) {
    conds.push(
      `(${CONTRACT_SORT_EXPR} < ? OR (${CONTRACT_SORT_EXPR} = ? AND c.contract_id < ?))`
    );
    binds.push(cursorSortDate, cursorSortDate, cursorContractId);
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const sql = `
    SELECT c.*,
      cl.client_name,
      (SELECT COUNT(*) FROM contract_items ci WHERE ci.contract_id = c.contract_id AND ci.status = 'active') AS item_count
    FROM contracts c
    LEFT JOIN clients cl ON cl.client_id = c.client_id
    ${where}
    ORDER BY ${CONTRACT_SORT_EXPR} DESC, c.contract_id DESC
    LIMIT ?
  `;
  const res = await db.prepare(sql).bind(...binds, limit).all();
  return res.results || [];
}
__name(listContractsSQL, "listContractsSQL");
async function getContractSQL(db, contractId) {
  return db.prepare("SELECT * FROM contracts WHERE contract_id = ?").bind(contractId).first();
}
__name(getContractSQL, "getContractSQL");
async function getContractItemsSQL(db, contractId) {
  const res = await db.prepare(
    `SELECT * FROM contract_items WHERE contract_id = ? ORDER BY created_at ASC`
  ).bind(contractId).all();
  return res.results || [];
}
__name(getContractItemsSQL, "getContractItemsSQL");
async function getContractItemsForRfqItemSQL(db, rfqItemId) {
  const res = await db.prepare(
    `SELECT ci.*, c.contract_no, c.signed_date, c.contract_name,
            c.status AS contract_status, c.currency AS contract_currency,
            c.rfq_id AS contract_rfq_id
     FROM contract_items ci
     JOIN contracts c ON c.contract_id = ci.contract_id
     WHERE ci.rfq_item_id = ?
     ORDER BY COALESCE(c.signed_date, c.created_at) DESC, ci.created_at DESC
     LIMIT 20`
  ).bind(rfqItemId).all();
  return res.results || [];
}
__name(getContractItemsForRfqItemSQL, "getContractItemsForRfqItemSQL");
async function insertContractSQL(db, row) {
  return db.prepare(
    `INSERT INTO contracts (
      contract_id, rfq_id, contract_no, contract_name, client_id,
      signed_date, effective_date, expiry_date, currency, contract_total,
      status, note, created_by, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.contract_id,
    row.rfq_id,
    row.contract_no,
    row.contract_name,
    row.client_id,
    row.signed_date,
    row.effective_date,
    row.expiry_date,
    row.currency,
    row.contract_total,
    row.status,
    row.note,
    row.created_by,
    row.created_at,
    row.updated_at,
    row.archived_at
  ).run();
}
__name(insertContractSQL, "insertContractSQL");
async function updateContractSQL(db, row) {
  return db.prepare(
    `UPDATE contracts SET
      rfq_id = ?, contract_no = ?, contract_name = ?, client_id = ?,
      signed_date = ?, effective_date = ?, expiry_date = ?,
      currency = ?, status = ?, note = ?, updated_at = ?
     WHERE contract_id = ?`
  ).bind(
    row.rfq_id,
    row.contract_no,
    row.contract_name,
    row.client_id,
    row.signed_date,
    row.effective_date,
    row.expiry_date,
    row.currency,
    row.status,
    row.note,
    row.updated_at,
    row.contract_id
  ).run();
}
__name(updateContractSQL, "updateContractSQL");
async function archiveContractSQL(db, contractId, archivedAt) {
  return db.prepare(
    `UPDATE contracts SET status = 'archived', archived_at = ?, updated_at = ? WHERE contract_id = ?`
  ).bind(archivedAt, archivedAt, contractId).run();
}
__name(archiveContractSQL, "archiveContractSQL");
async function insertContractItemSQL(db, row) {
  return db.prepare(
    `INSERT INTO contract_items (
      contract_item_id, contract_id, rfq_item_id, item_id, line_no,
      ma_vat_tu, ten_vat_tu, required_model, manufacturer, brand,
      origin_country, unit, contract_quantity, contract_unit_price, contract_line_total,
      delivery_lead_days, delivery_trigger_type, delivery_trigger_date, delivery_deadline_date,
      supplier_id, supplier_name, source_quote_id, status, note,
      created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.contract_item_id,
    row.contract_id,
    row.rfq_item_id,
    row.item_id,
    row.line_no,
    row.ma_vat_tu,
    row.ten_vat_tu,
    row.required_model,
    row.manufacturer,
    row.brand,
    row.origin_country,
    row.unit,
    row.contract_quantity,
    row.contract_unit_price,
    row.contract_line_total,
    row.delivery_lead_days,
    row.delivery_trigger_type,
    row.delivery_trigger_date,
    row.delivery_deadline_date,
    row.supplier_id,
    row.supplier_name,
    row.source_quote_id,
    row.status,
    row.note,
    row.created_at,
    row.updated_at,
    row.archived_at
  ).run();
}
__name(insertContractItemSQL, "insertContractItemSQL");
async function getContractItemSQL(db, contractItemId) {
  return db.prepare("SELECT * FROM contract_items WHERE contract_item_id = ?").bind(contractItemId).first();
}
__name(getContractItemSQL, "getContractItemSQL");
async function updateContractItemSQL(db, row) {
  return db.prepare(
    `UPDATE contract_items SET
      line_no = ?, ma_vat_tu = ?, ten_vat_tu = ?, required_model = ?,
      manufacturer = ?, brand = ?, origin_country = ?, unit = ?,
      contract_quantity = ?, contract_unit_price = ?, contract_line_total = ?,
      delivery_lead_days = ?, delivery_trigger_type = ?, delivery_trigger_date = ?, delivery_deadline_date = ?,
      supplier_id = ?, supplier_name = ?, source_quote_id = ?, note = ?, updated_at = ?
     WHERE contract_item_id = ?`
  ).bind(
    row.line_no,
    row.ma_vat_tu,
    row.ten_vat_tu,
    row.required_model,
    row.manufacturer,
    row.brand,
    row.origin_country,
    row.unit,
    row.contract_quantity,
    row.contract_unit_price,
    row.contract_line_total,
    row.delivery_lead_days,
    row.delivery_trigger_type,
    row.delivery_trigger_date,
    row.delivery_deadline_date,
    row.supplier_id,
    row.supplier_name,
    row.source_quote_id,
    row.note,
    row.updated_at,
    row.contract_item_id
  ).run();
}
__name(updateContractItemSQL, "updateContractItemSQL");
async function archiveContractItemSQL(db, contractItemId, archivedAt) {
  return db.prepare(
    `UPDATE contract_items SET status = 'archived', archived_at = ?, updated_at = ? WHERE contract_item_id = ?`
  ).bind(archivedAt, archivedAt, contractItemId).run();
}
__name(archiveContractItemSQL, "archiveContractItemSQL");
async function recalcContractTotalSQL(db, contractId, now) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(contract_line_total), 0) AS total
     FROM contract_items WHERE contract_id = ? AND status = 'active'`
  ).bind(contractId).first();
  const total = row?.total || 0;
  await db.prepare(
    `UPDATE contracts SET contract_total = ?, updated_at = ? WHERE contract_id = ?`
  ).bind(total, now, contractId).run();
  return total;
}
__name(recalcContractTotalSQL, "recalcContractTotalSQL");

// src/worker/handlers/contracts.js
var VALID_CURRENCY2 = /* @__PURE__ */ new Set(["VND", "USD", "EUR", "JPY", "CNY", "SGD", "KRW"]);
var VALID_DELIVERY_TRIGGER_TYPE = /* @__PURE__ */ new Set(["contract_sign", "award_notice", "delivery_notice", "po_date", "manual"]);
var DATE_RE2 = /^\d{4}-\d{2}-\d{2}$/;
async function handleContracts(action, request, env, ctx, actor) {
  if (action === "getContracts") return listContracts(request, env, actor);
  if (action === "getContractDetail") return getDetail(request, env, actor);
  if (action === "getContractItemsForRfqItem") return getItemsForRfqItem(request, env, actor);
  if (action === "createContract") return saveContract(request, env, ctx, actor, false);
  if (action === "updateContract") return saveContract(request, env, ctx, actor, true);
  if (action === "archiveContract") return archiveContract(request, env, ctx, actor);
  if (action === "addContractItem") return addItem(request, env, ctx, actor);
  if (action === "updateContractItem") return updateItem(request, env, ctx, actor);
  if (action === "archiveContractItem") return archiveItem2(request, env, ctx, actor);
  if (action === "createContractFromRfqItem") return createFromRfqItem(request, env, ctx, actor);
  return json({ ok: false, error: "Unknown contract action" }, 400);
}
__name(handleContracts, "handleContracts");
async function listContracts(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const limit = clampLimit(body.limit, 50, 200);
  let cursorSortDate = null;
  let cursorContractId = null;
  const cursorRaw = cleanString(body.cursor || "", 200);
  if (cursorRaw) {
    const parts = cursorRaw.split("|");
    if (parts.length === 2 && parts[0] && parts[1]) {
      cursorSortDate = parts[0];
      cursorContractId = parts[1];
    }
  }
  const rows = await listContractsSQL(env.DB, {
    q: cleanString(body.q || "", 200),
    rfqId: cleanString(body.rfqId || body.rfq_id || "", 80),
    clientId: cleanString(body.clientId || body.client_id || "", 80),
    status: cleanString(body.status || "", 20),
    dateFrom: cleanString(body.dateFrom || "", 20),
    dateTo: cleanString(body.dateTo || "", 20),
    cursorSortDate,
    cursorContractId,
    limit: limit + 1
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  let nextCursor = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = (last.signed_date || last.created_at) + "|" + last.contract_id;
  }
  return json({ ok: true, rows: page, hasMore, nextCursor });
}
__name(listContracts, "listContracts");
async function getDetail(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const contractId = cleanString(body.contractId || body.contract_id || "", 80);
  if (!contractId) return json({ ok: false, error: "Thieu ma hop dong" }, 400);
  const contract = await getContractSQL(env.DB, contractId);
  if (!contract) return json({ ok: false, error: "Khong tim thay hop dong" }, 404);
  const items = await getContractItemsSQL(env.DB, contractId);
  return json({ ok: true, contract, items });
}
__name(getDetail, "getDetail");
async function getItemsForRfqItem(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id || "", 80);
  if (!rfqItemId) return json({ ok: false, error: "Thieu rfqItemId" }, 400);
  const rows = await getContractItemsForRfqItemSQL(env.DB, rfqItemId);
  return json({ ok: true, rows });
}
__name(getItemsForRfqItem, "getItemsForRfqItem");
async function saveContract(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();
  const oldContract = isUpdate ? await getContractSQL(env.DB, cleanString(body.contractId || body.contract_id || "", 80)) : null;
  if (isUpdate && !oldContract) return json({ ok: false, error: "Khong tim thay hop dong" }, 404);
  if (isUpdate && oldContract.status === "archived") {
    return json({ ok: false, error: "Hop dong da luu tru, khong sua duoc" }, 400);
  }
  const contractNo = cleanString(body.contractNo || body.contract_no || "", 200);
  if (!contractNo) return json({ ok: false, error: "So hop dong la bat buoc" }, 400);
  const rfqId = cleanString(body.rfqId || body.rfq_id || oldContract?.rfq_id || "", 80);
  let clientId = cleanString(body.clientId || body.client_id || oldContract?.client_id || "", 80);
  if (rfqId && !clientId) {
    const rfq = await getRfqSQL(env.DB, rfqId);
    clientId = rfq?.client_id || "";
  }
  const rawCurrency = cleanString(body.currency || oldContract?.currency || "VND", 10).toUpperCase();
  const currency = VALID_CURRENCY2.has(rawCurrency) ? rawCurrency : "VND";
  const contract = {
    contract_id: isUpdate ? oldContract.contract_id : makeId("CTR"),
    rfq_id: rfqId || null,
    contract_no: contractNo,
    contract_name: cleanString(body.contractName || body.contract_name || oldContract?.contract_name || "", 300),
    client_id: clientId || null,
    signed_date: validateDate(body.signedDate || body.signed_date || oldContract?.signed_date || ""),
    effective_date: validateDate(body.effectiveDate || body.effective_date || oldContract?.effective_date || ""),
    expiry_date: validateDate(body.expiryDate || body.expiry_date || oldContract?.expiry_date || ""),
    currency,
    contract_total: isUpdate ? oldContract.contract_total : 0,
    status: isUpdate ? oldContract.status || "active" : "active",
    note: cleanString(body.note || oldContract?.note || "", 2e3),
    created_by: isUpdate ? oldContract.created_by : actor.id,
    created_at: isUpdate ? oldContract.created_at : now,
    updated_at: now,
    archived_at: oldContract?.archived_at || null
  };
  if (isUpdate) {
    await updateContractSQL(env.DB, contract);
  } else {
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const contractItems = [];
    for (const p of rawItems) {
      const ci = await buildContractItem(env.DB, contract.contract_id, p, now, contract);
      if (!ci) continue;
      if (ci.delivery_error) return json({ ok: false, error: ci.delivery_error }, 400);
      contractItems.push(ci);
    }
    await insertContractSQL(env.DB, contract);
    for (const ci of contractItems) {
      await insertContractItemSQL(env.DB, ci);
    }
    if (contractItems.length > 0) {
      contract.contract_total = await recalcContractTotalSQL(env.DB, contract.contract_id, now);
    }
  }
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? "updateContract" : "createContract",
    entityType: "contract",
    entityId: contract.contract_id,
    oldJson: oldContract,
    newJson: contract,
    actor
  }));
  return json({ ok: true, contract });
}
__name(saveContract, "saveContract");
async function archiveContract(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const contractId = cleanString(body.contractId || body.contract_id || "", 80);
  if (!contractId) return json({ ok: false, error: "Thieu ma hop dong" }, 400);
  const old = await getContractSQL(env.DB, contractId);
  if (!old) return json({ ok: false, error: "Khong tim thay hop dong" }, 404);
  if (old.status === "archived") return json({ ok: false, error: "Hop dong da luu tru" }, 400);
  const now = nowIso();
  await archiveContractSQL(env.DB, contractId, now);
  ctx.waitUntil(writeActionLog(env, {
    action: "archiveContract",
    entityType: "contract",
    entityId: contractId,
    oldJson: old,
    newJson: { ...old, status: "archived", archived_at: now, updated_at: now },
    actor
  }));
  return json({ ok: true });
}
__name(archiveContract, "archiveContract");
async function addItem(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const contractId = cleanString(body.contractId || body.contract_id || "", 80);
  if (!contractId) return json({ ok: false, error: "Thieu ma hop dong" }, 400);
  const contract = await getContractSQL(env.DB, contractId);
  if (!contract) return json({ ok: false, error: "Khong tim thay hop dong" }, 404);
  if (contract.status === "archived") return json({ ok: false, error: "Hop dong da luu tru" }, 400);
  const now = nowIso();
  const ci = await buildContractItem(env.DB, contractId, body, now, contract);
  if (!ci) return json({ ok: false, error: "ten_vat_tu la bat buoc" }, 400);
  if (ci.delivery_error) return json({ ok: false, error: ci.delivery_error }, 400);
  await insertContractItemSQL(env.DB, ci);
  const newTotal = await recalcContractTotalSQL(env.DB, contractId, now);
  ctx.waitUntil(writeActionLog(env, {
    action: "addContractItem",
    entityType: "contract_item",
    entityId: ci.contract_item_id,
    oldJson: null,
    newJson: ci,
    actor
  }));
  return json({ ok: true, item: ci, contract_total: newTotal });
}
__name(addItem, "addItem");
async function updateItem(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const contractItemId = cleanString(body.contractItemId || body.contract_item_id || "", 80);
  if (!contractItemId) return json({ ok: false, error: "Thieu ma dong hop dong" }, 400);
  const old = await getContractItemSQL(env.DB, contractItemId);
  if (!old) return json({ ok: false, error: "Khong tim thay dong hop dong" }, 404);
  if (old.status === "archived") return json({ ok: false, error: "Dong hop dong da luu tru" }, 400);
  const tenVatTu = cleanString(body.tenVatTu || body.ten_vat_tu || old.ten_vat_tu, 500);
  if (!tenVatTu) return json({ ok: false, error: "ten_vat_tu la bat buoc" }, 400);
  const now = nowIso();
  const qty = cleanNumber(body.contractQuantity ?? body.contract_quantity ?? old.contract_quantity);
  const price = Math.round(cleanNumber(body.contractUnitPrice ?? body.contract_unit_price ?? old.contract_unit_price));
  const line = Math.round(cleanNumber(body.contractLineTotal ?? body.contract_line_total ?? qty * price)) || Math.round(qty * price);
  const contract = await getContractSQL(env.DB, old.contract_id);
  const deadline = buildDeliveryDeadlineFields(body, old, contract);
  if (!deadline.ok) return json({ ok: false, error: deadline.error }, 400);
  const updated = {
    contract_item_id: contractItemId,
    line_no: cleanString(body.lineNo || body.line_no || old.line_no || "", 40),
    ma_vat_tu: cleanString(body.maVatTu || body.ma_vat_tu || old.ma_vat_tu || "", 120),
    ten_vat_tu: tenVatTu,
    required_model: cleanString(body.requiredModel || body.required_model || old.required_model || "", 400),
    manufacturer: cleanString(body.manufacturer || old.manufacturer || "", 180),
    brand: cleanString(body.brand || old.brand || "", 120),
    origin_country: cleanString(body.originCountry || body.origin_country || old.origin_country || "", 120),
    unit: cleanString(body.unit || old.unit || "", 40),
    contract_quantity: qty,
    contract_unit_price: price,
    contract_line_total: line,
    ...deadline.fields,
    supplier_id: cleanString(body.supplierId || body.supplier_id || old.supplier_id || "", 80) || null,
    supplier_name: cleanString(body.supplierName || body.supplier_name || old.supplier_name || "", 180),
    source_quote_id: cleanString(body.sourceQuoteId || body.source_quote_id || old.source_quote_id || "", 80) || null,
    note: cleanString(body.note || old.note || "", 2e3),
    updated_at: now
  };
  await updateContractItemSQL(env.DB, updated);
  const newTotal = await recalcContractTotalSQL(env.DB, old.contract_id, now);
  ctx.waitUntil(writeActionLog(env, {
    action: "updateContractItem",
    entityType: "contract_item",
    entityId: contractItemId,
    oldJson: old,
    newJson: { ...old, ...updated },
    actor
  }));
  return json({ ok: true, item: { ...old, ...updated }, contract_total: newTotal });
}
__name(updateItem, "updateItem");
async function archiveItem2(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const contractItemId = cleanString(body.contractItemId || body.contract_item_id || "", 80);
  if (!contractItemId) return json({ ok: false, error: "Thieu ma dong hop dong" }, 400);
  const old = await getContractItemSQL(env.DB, contractItemId);
  if (!old) return json({ ok: false, error: "Khong tim thay dong hop dong" }, 404);
  if (old.status === "archived") return json({ ok: false, error: "Dong hop dong da luu tru" }, 400);
  const now = nowIso();
  await archiveContractItemSQL(env.DB, contractItemId, now);
  const newTotal = await recalcContractTotalSQL(env.DB, old.contract_id, now);
  ctx.waitUntil(writeActionLog(env, {
    action: "archiveContractItem",
    entityType: "contract_item",
    entityId: contractItemId,
    oldJson: old,
    newJson: { ...old, status: "archived", archived_at: now, updated_at: now },
    actor
  }));
  return json({ ok: true, contract_total: newTotal });
}
__name(archiveItem2, "archiveItem");
async function createFromRfqItem(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id || "", 80);
  if (!rfqItemId) return json({ ok: false, error: "Thieu rfqItemId" }, 400);
  const contractNo = cleanString(body.contractNo || body.contract_no || "", 200);
  if (!contractNo) return json({ ok: false, error: "So hop dong la bat buoc" }, 400);
  const rfqItem = await getRfqItemSQL(env.DB, rfqItemId);
  if (!rfqItem) return json({ ok: false, error: "Khong tim thay dong vat tu" }, 404);
  const rfqId = rfqItem.rfq_id || "";
  let clientId = cleanString(body.clientId || body.client_id || "", 80);
  if (rfqId && !clientId) {
    const rfq = await getRfqSQL(env.DB, rfqId);
    clientId = rfq?.client_id || "";
  }
  const rawCurrency = cleanString(body.currency || "VND", 10).toUpperCase();
  const currency = VALID_CURRENCY2.has(rawCurrency) ? rawCurrency : "VND";
  const contract = {
    contract_id: makeId("CTR"),
    rfq_id: rfqId || null,
    contract_no: contractNo,
    contract_name: cleanString(body.contractName || body.contract_name || "", 300),
    client_id: clientId || null,
    signed_date: validateDate(body.signedDate || body.signed_date || ""),
    effective_date: validateDate(body.effectiveDate || body.effective_date || ""),
    expiry_date: validateDate(body.expiryDate || body.expiry_date || ""),
    currency,
    contract_total: 0,
    status: "active",
    note: cleanString(body.note || "", 2e3),
    created_by: actor.id,
    created_at: now,
    updated_at: now,
    archived_at: null
  };
  const ci = await buildContractItem(env.DB, contract.contract_id, {
    ...body,
    rfqItemId,
    tenVatTu: rfqItem.ten_vat_tu
  }, now, contract);
  if (ci?.delivery_error) return json({ ok: false, error: ci.delivery_error }, 400);
  await insertContractSQL(env.DB, contract);
  if (ci) {
    await insertContractItemSQL(env.DB, ci);
    contract.contract_total = await recalcContractTotalSQL(env.DB, contract.contract_id, now);
  }
  ctx.waitUntil(writeActionLog(env, {
    action: "createContractFromRfqItem",
    entityType: "contract",
    entityId: contract.contract_id,
    oldJson: null,
    newJson: contract,
    actor
  }));
  return json({ ok: true, contract, item: ci });
}
__name(createFromRfqItem, "createFromRfqItem");
async function buildContractItem(db, contractId, p, now, contract = null) {
  let maVatTu = cleanString(p.maVatTu || p.ma_vat_tu || "", 120);
  let tenVatTu = cleanString(p.tenVatTu || p.ten_vat_tu || "", 500);
  let model = cleanString(p.requiredModel || p.required_model || "", 400);
  let mfr = cleanString(p.manufacturer || "", 180);
  let brand = cleanString(p.brand || "", 120);
  let origin = cleanString(p.originCountry || p.origin_country || "", 120);
  let unit = cleanString(p.unit || "", 40);
  let itemId = cleanString(p.itemId || p.item_id || "", 80) || null;
  let supplierId = cleanString(p.supplierId || p.supplier_id || "", 80) || null;
  let supplierName = cleanString(p.supplierName || p.supplier_name || "", 180);
  let qty = cleanNumber(p.contractQuantity ?? p.contract_quantity ?? 0);
  let price = Math.round(cleanNumber(p.contractUnitPrice ?? p.contract_unit_price ?? 0));
  const rfqItemId = cleanString(p.rfqItemId || p.rfq_item_id || "", 80) || null;
  const sourceQuoteId = cleanString(p.sourceQuoteId || p.source_quote_id || "", 80) || null;
  if (rfqItemId) {
    const ri = await getRfqItemSQL(db, rfqItemId);
    if (ri) {
      if (!maVatTu) maVatTu = cleanString(ri.ma_vat_tu || "", 120);
      if (!tenVatTu) tenVatTu = cleanString(ri.ten_vat_tu || "", 500);
      if (!model) model = cleanString(ri.required_model || ri.quy_cach_model_yeu_cau || "", 400);
      if (!mfr) mfr = cleanString(ri.manufacturer || ri.hang_goc_nsx_goc || "", 180);
      if (!brand) brand = cleanString(ri.brand || ri.nhan_hieu || "", 120);
      if (!origin) origin = cleanString(ri.origin_country || ri.xuat_xu || "", 120);
      if (!unit) unit = cleanString(ri.unit || ri.don_vi || "", 40);
      if (!qty) qty = cleanNumber(ri.quantity ?? ri.so_luong ?? 0);
      if (!itemId) itemId = ri.item_id || null;
    }
  }
  if (sourceQuoteId) {
    const sq = await getSupplierQuoteSQL(db, sourceQuoteId);
    if (sq) {
      if (!supplierId) supplierId = sq.supplier_id || null;
      if (!supplierName) supplierName = cleanString(sq.supplier_name || "", 180);
      if (!mfr) mfr = cleanString(sq.manufacturer || "", 180);
      if (!price && sq.price_vnd_incl_tax) price = sq.price_vnd_incl_tax;
    }
  }
  if (!tenVatTu) return null;
  const lineTotal = Math.round(
    cleanNumber(p.contractLineTotal ?? p.contract_line_total ?? qty * price)
  ) || Math.round(qty * price);
  const deadline = buildDeliveryDeadlineFields(p, null, contract);
  if (!deadline.ok) return { delivery_error: deadline.error };
  return {
    contract_item_id: makeId("CI"),
    contract_id: contractId,
    rfq_item_id: rfqItemId,
    item_id: itemId,
    line_no: cleanString(p.lineNo || p.line_no || "", 40),
    ma_vat_tu: maVatTu || null,
    ten_vat_tu: tenVatTu,
    required_model: model || null,
    manufacturer: mfr || null,
    brand: brand || null,
    origin_country: origin || null,
    unit: unit || null,
    contract_quantity: qty,
    contract_unit_price: price,
    contract_line_total: lineTotal,
    ...deadline.fields,
    supplier_id: supplierId,
    supplier_name: supplierName || null,
    source_quote_id: sourceQuoteId,
    status: "active",
    note: cleanString(p.note || "", 2e3),
    created_at: now,
    updated_at: now,
    archived_at: null
  };
}
__name(buildContractItem, "buildContractItem");
function validateDate(value) {
  const s = cleanString(value || "", 20);
  return DATE_RE2.test(s) ? s : "";
}
__name(validateDate, "validateDate");
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}
__name(hasOwn, "hasOwn");
function pickPayloadValue(obj, keys) {
  for (const key of keys) {
    if (hasOwn(obj, key)) return { present: true, value: obj[key] };
  }
  return { present: false, value: void 0 };
}
__name(pickPayloadValue, "pickPayloadValue");
function optionalDate(value, fieldName) {
  if (value === void 0 || value === null || value === "") return { ok: true, value: null };
  const s = cleanString(value, 20);
  if (!s) return { ok: true, value: null };
  if (!DATE_RE2.test(s)) return { ok: false, error: `${fieldName} khong hop le` };
  return { ok: true, value: s };
}
__name(optionalDate, "optionalDate");
function optionalLeadDays(value) {
  if (value === void 0 || value === null || value === "") return { ok: true, value: null };
  const raw = String(value).trim();
  if (!raw) return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, error: "So ngay giao hang phai la so nguyen >= 0" };
  }
  return { ok: true, value: n };
}
__name(optionalLeadDays, "optionalLeadDays");
function addDaysYmd2(dateStr, days) {
  if (!DATE_RE2.test(String(dateStr || "")) || days === null || days === void 0) return null;
  const d = /* @__PURE__ */ new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}
__name(addDaysYmd2, "addDaysYmd");
function buildDeliveryDeadlineFields(payload, oldItem = null, contract = null) {
  const leadRaw = pickPayloadValue(payload, ["deliveryLeadDays", "delivery_lead_days"]);
  const typeRaw = pickPayloadValue(payload, ["deliveryTriggerType", "delivery_trigger_type"]);
  const triggerDateRaw = pickPayloadValue(payload, ["deliveryTriggerDate", "delivery_trigger_date"]);
  const deadlineDateRaw = pickPayloadValue(payload, ["deliveryDeadlineDate", "delivery_deadline_date"]);
  const hasDeadlinePayload = leadRaw.present || typeRaw.present || triggerDateRaw.present || deadlineDateRaw.present;
  if (!hasDeadlinePayload && oldItem) {
    return {
      ok: true,
      fields: {
        delivery_lead_days: oldItem.delivery_lead_days ?? null,
        delivery_trigger_type: oldItem.delivery_trigger_type || null,
        delivery_trigger_date: oldItem.delivery_trigger_date || null,
        delivery_deadline_date: oldItem.delivery_deadline_date || null
      }
    };
  }
  const lead = leadRaw.present ? optionalLeadDays(leadRaw.value) : { ok: true, value: oldItem?.delivery_lead_days ?? null };
  if (!lead.ok) return lead;
  const triggerType = typeRaw.present ? cleanString(typeRaw.value || "", 40) || null : oldItem?.delivery_trigger_type || null;
  if (triggerType && !VALID_DELIVERY_TRIGGER_TYPE.has(triggerType)) {
    return { ok: false, error: "Loai moc tinh deadline giao hang khong hop le" };
  }
  const triggerDate = triggerDateRaw.present ? optionalDate(triggerDateRaw.value, "Ngay moc tinh deadline giao hang") : { ok: true, value: oldItem?.delivery_trigger_date || null };
  if (!triggerDate.ok) return triggerDate;
  const directDeadline = deadlineDateRaw.present ? optionalDate(deadlineDateRaw.value, "Ngay deadline giao hang") : { ok: true, value: oldItem?.delivery_deadline_date || null };
  if (!directDeadline.ok) return directDeadline;
  let deadlineDate = directDeadline.value || null;
  const leadDays = lead.value;
  const baseTriggerDate = triggerDate.value || null;
  if (triggerType === "contract_sign") {
    const baseDate = baseTriggerDate || validateDate(contract?.signed_date || "");
    deadlineDate = baseDate && leadDays !== null ? addDaysYmd2(baseDate, leadDays) : null;
  } else if (triggerType === "award_notice" || triggerType === "delivery_notice" || triggerType === "po_date") {
    deadlineDate = baseTriggerDate && leadDays !== null ? addDaysYmd2(baseTriggerDate, leadDays) : null;
  } else if (triggerType === "manual") {
    if (!deadlineDate && baseTriggerDate && leadDays !== null) {
      deadlineDate = addDaysYmd2(baseTriggerDate, leadDays);
    }
  }
  return {
    ok: true,
    fields: {
      delivery_lead_days: leadDays,
      delivery_trigger_type: triggerType,
      delivery_trigger_date: baseTriggerDate,
      delivery_deadline_date: deadlineDate
    }
  };
}
__name(buildDeliveryDeadlineFields, "buildDeliveryDeadlineFields");

// src/worker/db/delivery-queries.js
var DELIVERY_SORT_EXPR = "dn.delivery_date";
async function nextDeliveryNoteNoSQL(db, deliveryDate, noteType) {
  const d = String(deliveryDate || "");
  const year = d.slice(0, 4) || String((/* @__PURE__ */ new Date()).getUTCFullYear());
  const mmdd = d.replace(/-/g, "").slice(4, 8) || (() => {
    const n = /* @__PURE__ */ new Date();
    return String(n.getUTCMonth() + 1).padStart(2, "0") + String(n.getUTCDate()).padStart(2, "0");
  })();
  const code = noteType === "return" ? "DTH" : "DGH";
  const prefix = `${code}-${year}-${mmdd}-`;
  const row = await db.prepare(
    `SELECT delivery_note_no FROM delivery_notes
     WHERE delivery_note_no LIKE ?
     ORDER BY delivery_note_no DESC LIMIT 1`
  ).bind(`${prefix}%`).first();
  const last = row?.delivery_note_no ? Number(String(row.delivery_note_no).split("-").pop()) : 0;
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(3, "0")}`;
}
__name(nextDeliveryNoteNoSQL, "nextDeliveryNoteNoSQL");
async function listDeliveryNotesSQL(db, params) {
  const { q, rfqId, contractId, clientId, noteType, status, dateFrom, dateTo, cursorDate, cursorId, limit } = params;
  const conds = [];
  const binds = [];
  if (rfqId) {
    conds.push("dn.rfq_id = ?");
    binds.push(rfqId);
  }
  if (contractId) {
    conds.push("dn.contract_id = ?");
    binds.push(contractId);
  }
  if (clientId) {
    conds.push("dn.client_id = ?");
    binds.push(clientId);
  }
  if (noteType) {
    conds.push("dn.note_type = ?");
    binds.push(noteType);
  }
  if (status) {
    conds.push("dn.status = ?");
    binds.push(status);
  }
  if (dateFrom) {
    conds.push(`${DELIVERY_SORT_EXPR} >= ?`);
    binds.push(dateFrom);
  }
  if (dateTo) {
    conds.push(`${DELIVERY_SORT_EXPR} <= ?`);
    binds.push(dateTo);
  }
  if (q) {
    const like = `%${q}%`;
    conds.push("(dn.delivery_note_no LIKE ? OR dn.receiver_unit LIKE ? OR dn.sender_unit LIKE ? OR dn.note LIKE ? OR c.contract_no LIKE ? OR r.ten_goi LIKE ?)");
    binds.push(like, like, like, like, like, like);
  }
  if (cursorDate && cursorId) {
    conds.push(`(${DELIVERY_SORT_EXPR} < ? OR (${DELIVERY_SORT_EXPR} = ? AND dn.delivery_note_id < ?))`);
    binds.push(cursorDate, cursorDate, cursorId);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const res = await db.prepare(
    `SELECT dn.*,
            r.ma_goi_tbmt, r.ten_goi,
            c.contract_no, c.contract_name,
            cl.client_name,
            COALESCE(SUM(CASE WHEN dni.status = 'active' THEN dni.delivered_quantity ELSE 0 END), 0) AS delivered_quantity_total,
            COALESCE(SUM(CASE WHEN dni.status = 'active' THEN dni.accepted_quantity  ELSE 0 END), 0) AS accepted_quantity_total,
            COUNT(CASE WHEN dni.status = 'active' THEN 1 END) AS item_count
     FROM delivery_notes dn
     LEFT JOIN rfqs r ON r.rfq_id = dn.rfq_id
     LEFT JOIN contracts c ON c.contract_id = dn.contract_id
     LEFT JOIN clients cl ON cl.client_id = dn.client_id
     LEFT JOIN delivery_note_items dni ON dni.delivery_note_id = dn.delivery_note_id
     ${where}
     GROUP BY dn.delivery_note_id
     ORDER BY dn.delivery_date DESC, dn.delivery_note_id DESC
     LIMIT ?`
  ).bind(...binds, limit).all();
  return res.results || [];
}
__name(listDeliveryNotesSQL, "listDeliveryNotesSQL");
async function getDeliveryNoteSQL(db, deliveryNoteId) {
  return db.prepare(
    `SELECT dn.*, r.ma_goi_tbmt, r.ten_goi, c.contract_no, c.contract_name, cl.client_name
     FROM delivery_notes dn
     LEFT JOIN rfqs r ON r.rfq_id = dn.rfq_id
     LEFT JOIN contracts c ON c.contract_id = dn.contract_id
     LEFT JOIN clients cl ON cl.client_id = dn.client_id
     WHERE dn.delivery_note_id = ?`
  ).bind(deliveryNoteId).first();
}
__name(getDeliveryNoteSQL, "getDeliveryNoteSQL");
async function getDeliveryNoteItemsSQL(db, deliveryNoteId) {
  const res = await db.prepare(
    `WITH cumulative AS (
       SELECT x.rfq_item_id,
              COALESCE(SUM(x.delivered_quantity), 0) AS cumulative_delivered_qty
       FROM delivery_note_items x
       JOIN delivery_notes xdn ON xdn.delivery_note_id = x.delivery_note_id
       WHERE x.rfq_item_id IN (SELECT rfq_item_id FROM delivery_note_items WHERE delivery_note_id = ?)
         AND x.status = 'active' AND xdn.status = 'active'
       GROUP BY x.rfq_item_id
     ),
     clar_ranked AS (
       SELECT tc.rfq_item_id, tc.title,
              COUNT(*) OVER (PARTITION BY tc.rfq_item_id) AS clarification_count,
              ROW_NUMBER() OVER (PARTITION BY tc.rfq_item_id ORDER BY tc.created_at DESC, tc.sequence_no DESC) AS rn
       FROM technical_clarifications tc
       WHERE tc.deleted_at IS NULL
         AND tc.rfq_item_id IN (SELECT rfq_item_id FROM delivery_note_items WHERE delivery_note_id = ?)
     ),
     clar_summary AS (
       SELECT rfq_item_id, title AS latest_clarification_title, clarification_count
       FROM clar_ranked WHERE rn = 1
     )
     SELECT dni.*,
            COALESCE(ci.contract_quantity, ri.so_luong, ri.quantity, 0) AS contract_quantity, ci.contract_unit_price, ci.contract_line_total,
            ci.delivery_deadline_date,
            ri.stt_goc, ri.hang_final, ri.quy_cach_final, ri.vat_lieu, ri.thong_so_ky_thuat,
            COALESCE(cu.cumulative_delivered_qty, 0) AS cumulative_delivered_qty,
            COALESCE(cs.clarification_count, 0)      AS clarification_count,
            cs.latest_clarification_title
     FROM delivery_note_items dni
     LEFT JOIN contract_items ci  ON ci.contract_item_id = dni.contract_item_id
     LEFT JOIN rfq_items ri       ON ri.rfq_item_id      = dni.rfq_item_id
     LEFT JOIN cumulative cu      ON cu.rfq_item_id      = dni.rfq_item_id
     LEFT JOIN clar_summary cs    ON cs.rfq_item_id      = dni.rfq_item_id
     WHERE dni.delivery_note_id = ?
     ORDER BY dni.created_at ASC, dni.delivery_note_item_id ASC`
  ).bind(deliveryNoteId, deliveryNoteId, deliveryNoteId).all();
  return res.results || [];
}
__name(getDeliveryNoteItemsSQL, "getDeliveryNoteItemsSQL");
async function getDeliveryNoteItemStatusesSQL(db, deliveryNoteId) {
  const res = await db.prepare(
    `SELECT delivery_note_item_id, acceptance_status, accepted_quantity
     FROM delivery_note_items
     WHERE delivery_note_id = ? AND status = 'active'`
  ).bind(deliveryNoteId).all();
  return res.results || [];
}
__name(getDeliveryNoteItemStatusesSQL, "getDeliveryNoteItemStatusesSQL");
async function getDeliveryItemsForRfqItemSQL(db, rfqItemId) {
  const res = await db.prepare(
    `SELECT dni.*, dn.delivery_note_no, dn.delivery_date, dn.receiver_unit, dn.sender_unit,
            dn.status AS delivery_note_status, dn.contract_id, c.contract_no
     FROM delivery_note_items dni
     JOIN delivery_notes dn ON dn.delivery_note_id = dni.delivery_note_id
     LEFT JOIN contracts c ON c.contract_id = dn.contract_id
     WHERE dni.rfq_item_id = ?
     ORDER BY dn.delivery_date DESC, dn.delivery_note_id DESC, dni.created_at DESC
     LIMIT 50`
  ).bind(rfqItemId).all();
  return res.results || [];
}
__name(getDeliveryItemsForRfqItemSQL, "getDeliveryItemsForRfqItemSQL");
async function getDeliveryNoteItemSQL(db, deliveryNoteItemId) {
  return db.prepare("SELECT * FROM delivery_note_items WHERE delivery_note_item_id = ?").bind(deliveryNoteItemId).first();
}
__name(getDeliveryNoteItemSQL, "getDeliveryNoteItemSQL");
async function insertDeliveryNoteSQL(db, row) {
  return db.prepare(
    `INSERT INTO delivery_notes (
      delivery_note_id, delivery_note_no, note_type, rfq_id, contract_id, client_id,
      delivery_date, receiver_unit, sender_unit, receiver_name, sender_name,
      vehicle_no, note, status, created_by, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.delivery_note_id,
    row.delivery_note_no,
    row.note_type,
    row.rfq_id,
    row.contract_id,
    row.client_id,
    row.delivery_date,
    row.receiver_unit,
    row.sender_unit,
    row.receiver_name,
    row.sender_name,
    row.vehicle_no,
    row.note,
    row.status,
    row.created_by,
    row.created_at,
    row.updated_at,
    row.archived_at
  ).run();
}
__name(insertDeliveryNoteSQL, "insertDeliveryNoteSQL");
async function updateDeliveryNoteSQL(db, row) {
  return db.prepare(
    `UPDATE delivery_notes SET
      rfq_id = ?, contract_id = ?, client_id = ?, delivery_date = ?,
      receiver_unit = ?, sender_unit = ?, receiver_name = ?, sender_name = ?,
      vehicle_no = ?, note = ?, updated_at = ?
     WHERE delivery_note_id = ? AND status = 'active'`
  ).bind(
    row.rfq_id,
    row.contract_id,
    row.client_id,
    row.delivery_date,
    row.receiver_unit,
    row.sender_unit,
    row.receiver_name,
    row.sender_name,
    row.vehicle_no,
    row.note,
    row.updated_at,
    row.delivery_note_id
  ).run();
}
__name(updateDeliveryNoteSQL, "updateDeliveryNoteSQL");
async function archiveDeliveryNoteSQL(db, deliveryNoteId, now) {
  return db.prepare(
    `UPDATE delivery_notes SET status = 'archived', archived_at = ?, updated_at = ?
     WHERE delivery_note_id = ? AND status = 'active'`
  ).bind(now, now, deliveryNoteId).run();
}
__name(archiveDeliveryNoteSQL, "archiveDeliveryNoteSQL");
async function insertDeliveryNoteItemSQL(db, row) {
  return db.prepare(
    `INSERT INTO delivery_note_items (
      delivery_note_item_id, delivery_note_id, rfq_item_id, contract_item_id, item_id,
      line_no, ma_vat_tu, ten_vat_tu, required_model, manufacturer, brand,
      origin_country, unit, delivered_quantity, note, status,
      created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.delivery_note_item_id,
    row.delivery_note_id,
    row.rfq_item_id,
    row.contract_item_id,
    row.item_id,
    row.line_no,
    row.ma_vat_tu,
    row.ten_vat_tu,
    row.required_model,
    row.manufacturer,
    row.brand,
    row.origin_country,
    row.unit,
    row.delivered_quantity,
    row.note,
    row.status,
    row.created_at,
    row.updated_at,
    row.archived_at
  ).run();
}
__name(insertDeliveryNoteItemSQL, "insertDeliveryNoteItemSQL");
async function updateDeliveryNoteItemSQL(db, row) {
  return db.prepare(
    `UPDATE delivery_note_items SET
      contract_item_id = ?, item_id = ?, line_no = ?, ma_vat_tu = ?, ten_vat_tu = ?,
      required_model = ?, manufacturer = ?, brand = ?, origin_country = ?, unit = ?,
      delivered_quantity = ?, note = ?, updated_at = ?
     WHERE delivery_note_item_id = ? AND status = 'active'`
  ).bind(
    row.contract_item_id,
    row.item_id,
    row.line_no,
    row.ma_vat_tu,
    row.ten_vat_tu,
    row.required_model,
    row.manufacturer,
    row.brand,
    row.origin_country,
    row.unit,
    row.delivered_quantity,
    row.note,
    row.updated_at,
    row.delivery_note_item_id
  ).run();
}
__name(updateDeliveryNoteItemSQL, "updateDeliveryNoteItemSQL");
async function archiveDeliveryNoteItemSQL(db, deliveryNoteItemId, now) {
  return db.prepare(
    `UPDATE delivery_note_items SET status = 'archived', archived_at = ?, updated_at = ?
     WHERE delivery_note_item_id = ? AND status = 'active'`
  ).bind(now, now, deliveryNoteItemId).run();
}
__name(archiveDeliveryNoteItemSQL, "archiveDeliveryNoteItemSQL");
async function recordAcceptanceSQL(db, noteId, header, itemRows, now) {
  const stmts = [
    db.prepare(
      `UPDATE delivery_notes SET
         acceptance_date = ?, acceptance_status = ?, acceptance_note = ?,
         payment_request_status = ?, payment_request_date = ?,
         updated_at = ?
       WHERE delivery_note_id = ? AND status = 'active'`
    ).bind(
      header.acceptance_date,
      header.acceptance_status,
      header.acceptance_note,
      header.payment_request_status,
      header.payment_request_date,
      now,
      noteId
    )
  ];
  for (const it of itemRows) {
    stmts.push(
      db.prepare(
        `UPDATE delivery_note_items SET
           accepted_quantity = ?, acceptance_status = ?, rejection_reason = ?,
           warranty_days = ?, warranty_start_date = ?, warranty_end_date = ?,
           updated_at = ?
         WHERE delivery_note_item_id = ? AND delivery_note_id = ? AND status = 'active'`
      ).bind(
        it.accepted_quantity,
        it.acceptance_status,
        it.rejection_reason,
        it.warranty_days,
        it.warranty_start_date,
        it.warranty_end_date,
        now,
        it.delivery_note_item_id,
        noteId
      )
    );
  }
  return db.batch(stmts);
}
__name(recordAcceptanceSQL, "recordAcceptanceSQL");
async function deleteDeliveryNoteSQL(db, deliveryNoteId) {
  return db.batch([
    db.prepare("DELETE FROM delivery_note_items WHERE delivery_note_id = ?").bind(deliveryNoteId),
    db.prepare("DELETE FROM delivery_notes WHERE delivery_note_id = ?").bind(deliveryNoteId)
  ]);
}
__name(deleteDeliveryNoteSQL, "deleteDeliveryNoteSQL");

// src/worker/handlers/delivery.js
var VALID_STATUS = /* @__PURE__ */ new Set(["active", "archived"]);
var VALID_NOTE_TYPES = /* @__PURE__ */ new Set(["delivery", "return"]);
var VALID_ACCEPTANCE_ITEM_STATUSES = /* @__PURE__ */ new Set(["pending", "accepted", "rejected"]);
var DATE_RE3 = /^\d{4}-\d{2}-\d{2}$/;
var DASHBOARD_KEYS = ["dashboard:v1", "dashboard:v2"];
async function handleDelivery(action, request, env, ctx, actor) {
  if (action === "getDeliveryNotes") return listNotes(request, env, actor);
  if (action === "getDeliveryNoteDetail") return getNoteDetail(request, env, actor);
  if (action === "getDeliveryItemsForRfqItem") return getItemsForRfqItem2(request, env, actor);
  if (action === "createDeliveryNote") return saveNote(request, env, ctx, actor, false);
  if (action === "updateDeliveryNote") return saveNote(request, env, ctx, actor, true);
  if (action === "archiveDeliveryNote") return archiveNote(request, env, ctx, actor);
  if (action === "addDeliveryNoteItem") return saveItem2(request, env, ctx, actor, false);
  if (action === "updateDeliveryNoteItem") return saveItem2(request, env, ctx, actor, true);
  if (action === "archiveDeliveryNoteItem") return archiveItem3(request, env, ctx, actor);
  if (action === "recordDeliveryAcceptance") return recordAcceptance(request, env, ctx, actor);
  if (action === "deleteDeliveryNote") return deleteNote(request, env, ctx, actor);
  if (action === "previewDeliveryNoteNo") return previewNoteNo(request, env, actor);
  return json({ ok: false, error: "Unknown delivery action" }, 400);
}
__name(handleDelivery, "handleDelivery");
async function listNotes(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const limit = clampLimit(body.limit, 50, 200);
  const cursorRaw = cleanString(body.cursor || "", 200);
  let cursorDate = "";
  let cursorId = "";
  if (cursorRaw) {
    const parts = cursorRaw.split("|");
    if (parts.length === 2) {
      cursorDate = parts[0];
      cursorId = parts[1];
    }
  }
  const status = cleanString(body.status || "", 20);
  const noteType = cleanString(body.noteType || body.note_type || "", 20);
  const rows = await listDeliveryNotesSQL(env.DB, {
    q: cleanString(body.q || "", 200),
    rfqId: cleanString(body.rfqId || body.rfq_id || "", 80),
    contractId: cleanString(body.contractId || body.contract_id || "", 80),
    clientId: cleanString(body.clientId || body.client_id || "", 80),
    noteType: VALID_NOTE_TYPES.has(noteType) ? noteType : "",
    status: VALID_STATUS.has(status) ? status : "",
    dateFrom: validateDate2(body.dateFrom || body.date_from || ""),
    dateTo: validateDate2(body.dateTo || body.date_to || ""),
    cursorDate,
    cursorId,
    limit: limit + 1
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.delivery_date}|${last.delivery_note_id}` : null;
  return json({ ok: true, rows: page, hasMore, nextCursor });
}
__name(listNotes, "listNotes");
async function getNoteDetail(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const deliveryNoteId = cleanString(body.deliveryNoteId || body.delivery_note_id || "", 80);
  if (!deliveryNoteId) return json({ ok: false, error: "Thieu ma phieu giao hang" }, 400);
  const note = await getDeliveryNoteSQL(env.DB, deliveryNoteId);
  if (!note) return json({ ok: false, error: "Khong tim thay phieu giao hang" }, 404);
  const items = await getDeliveryNoteItemsSQL(env.DB, deliveryNoteId);
  return json({ ok: true, note, items });
}
__name(getNoteDetail, "getNoteDetail");
async function getItemsForRfqItem2(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const rfqItemId = cleanString(body.rfqItemId || body.rfq_item_id || "", 80);
  if (!rfqItemId) return json({ ok: false, error: "Thieu rfqItemId" }, 400);
  const rows = await getDeliveryItemsForRfqItemSQL(env.DB, rfqItemId);
  return json({ ok: true, rows });
}
__name(getItemsForRfqItem2, "getItemsForRfqItem");
async function saveNote(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();
  const deliveryNoteId = cleanString(body.deliveryNoteId || body.delivery_note_id || "", 80);
  const oldNote = isUpdate ? await getDeliveryNoteSQL(env.DB, deliveryNoteId) : null;
  if (isUpdate && !oldNote) return json({ ok: false, error: "Khong tim thay phieu giao hang" }, 404);
  if (isUpdate && oldNote.status === "archived") return json({ ok: false, error: "Phieu da luu tru, khong sua duoc" }, 400);
  const deliveryDate = validateDate2(body.deliveryDate || body.delivery_date || oldNote?.delivery_date || "");
  if (!deliveryDate) return json({ ok: false, error: "Ngay giao hang khong hop le" }, 400);
  const rawNoteType = cleanString(body.noteType || body.note_type || oldNote?.note_type || "", 20);
  const noteType = VALID_NOTE_TYPES.has(rawNoteType) ? rawNoteType : "delivery";
  const rfqId = cleanString(body.rfqId || body.rfq_id || oldNote?.rfq_id || "", 80);
  const contractId = cleanString(body.contractId || body.contract_id || oldNote?.contract_id || "", 80);
  let clientId = cleanString(body.clientId || body.client_id || oldNote?.client_id || "", 80);
  if (rfqId) {
    const rfq = await getRfqSQL(env.DB, rfqId);
    if (!rfq) return json({ ok: false, error: "RFQ khong ton tai" }, 400);
    if (!clientId) clientId = rfq.client_id || "";
  }
  if (contractId) {
    const contract = await getContractSQL(env.DB, contractId);
    if (!contract) return json({ ok: false, error: "Hop dong khong ton tai" }, 400);
    if (!clientId) clientId = contract.client_id || "";
  }
  const manualNo = isUpdate ? null : cleanString(body.deliveryNoteNo || body.delivery_note_no || "", 80);
  const note = {
    delivery_note_id: isUpdate ? oldNote.delivery_note_id : makeId("DN"),
    delivery_note_no: isUpdate ? oldNote.delivery_note_no : manualNo || await nextDeliveryNoteNoSQL(env.DB, deliveryDate, noteType),
    note_type: isUpdate ? oldNote.note_type : noteType,
    rfq_id: rfqId || null,
    contract_id: contractId || null,
    client_id: clientId || null,
    delivery_date: deliveryDate,
    receiver_unit: cleanString(body.receiverUnit || body.receiver_unit || oldNote?.receiver_unit || "", 200),
    sender_unit: cleanString(body.senderUnit || body.sender_unit || oldNote?.sender_unit || "", 200),
    receiver_name: cleanString(body.receiverName || body.receiver_name || oldNote?.receiver_name || "", 120),
    sender_name: cleanString(body.senderName || body.sender_name || oldNote?.sender_name || "", 120),
    vehicle_no: cleanString(body.vehicleNo || body.vehicle_no || oldNote?.vehicle_no || "", 80),
    note: cleanString(body.note || oldNote?.note || "", 2e3),
    status: isUpdate ? oldNote.status : "active",
    created_by: isUpdate ? oldNote.created_by : actor.id,
    created_at: isUpdate ? oldNote.created_at : now,
    updated_at: now,
    archived_at: oldNote?.archived_at || null
  };
  if (isUpdate) {
    await updateDeliveryNoteSQL(env.DB, note);
  } else {
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      if (attempt > 0) {
        note.delivery_note_no = await nextDeliveryNoteNoSQL(env.DB, deliveryDate, noteType);
      }
      try {
        await insertDeliveryNoteSQL(env.DB, note);
        inserted = true;
      } catch (e) {
        const msg = String(e?.message || "");
        if (attempt >= 2 || !msg.includes("UNIQUE")) throw e;
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
    action: isUpdate ? "updateDeliveryNote" : "createDeliveryNote",
    entityType: "delivery_note",
    entityId: note.delivery_note_id,
    message: isUpdate ? `Cap nhat phieu giao hang ${note.delivery_note_no}` : `Tao phieu giao hang ${note.delivery_note_no}`,
    oldJson: oldNote,
    newJson: createdItems.length ? { ...note, items: createdItems } : note,
    actor
  }));
  return json({ ok: true, note, items: createdItems });
}
__name(saveNote, "saveNote");
async function archiveNote(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const deliveryNoteId = cleanString(body.deliveryNoteId || body.delivery_note_id || "", 80);
  if (!deliveryNoteId) return json({ ok: false, error: "Thieu ma phieu giao hang" }, 400);
  const old = await getDeliveryNoteSQL(env.DB, deliveryNoteId);
  if (!old) return json({ ok: false, error: "Khong tim thay phieu giao hang" }, 404);
  if (old.status === "archived") return json({ ok: false, error: "Phieu da luu tru" }, 400);
  const now = nowIso();
  await archiveDeliveryNoteSQL(env.DB, deliveryNoteId, now);
  ctx.waitUntil(invalidateKv(env, DASHBOARD_KEYS));
  ctx.waitUntil(writeActionLog(env, {
    action: "archiveDeliveryNote",
    entityType: "delivery_note",
    entityId: deliveryNoteId,
    oldJson: old,
    newJson: { ...old, status: "archived", archived_at: now, updated_at: now },
    actor
  }));
  return json({ ok: true });
}
__name(archiveNote, "archiveNote");
async function saveItem2(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();
  const deliveryNoteItemId = cleanString(body.deliveryNoteItemId || body.delivery_note_item_id || "", 80);
  const oldItem = isUpdate ? await getDeliveryNoteItemSQL(env.DB, deliveryNoteItemId) : null;
  if (isUpdate && !oldItem) return json({ ok: false, error: "Khong tim thay dong giao hang" }, 404);
  if (isUpdate && oldItem.status === "archived") return json({ ok: false, error: "Dong da luu tru, khong sua duoc" }, 400);
  const deliveryNoteId = cleanString(body.deliveryNoteId || body.delivery_note_id || oldItem?.delivery_note_id || "", 80);
  const deliveryNote = await getDeliveryNoteSQL(env.DB, deliveryNoteId);
  if (!deliveryNote) return json({ ok: false, error: "Khong tim thay phieu giao hang" }, 404);
  if (deliveryNote.status === "archived") return json({ ok: false, error: "Phieu da luu tru, khong sua duoc" }, 400);
  const item = await buildDeliveryItem(env.DB, { ...body, deliveryNoteId, oldItem }, now, oldItem);
  if (!item) return json({ ok: false, error: "Dong giao hang khong hop le" }, 400);
  if (isUpdate) await updateDeliveryNoteItemSQL(env.DB, item);
  else await insertDeliveryNoteItemSQL(env.DB, item);
  ctx.waitUntil(invalidateKv(env, DASHBOARD_KEYS));
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? "updateDeliveryNoteItem" : "addDeliveryNoteItem",
    entityType: "delivery_note_item",
    entityId: item.delivery_note_item_id,
    oldJson: oldItem,
    newJson: item,
    actor
  }));
  return json({ ok: true, item });
}
__name(saveItem2, "saveItem");
async function archiveItem3(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const deliveryNoteItemId = cleanString(body.deliveryNoteItemId || body.delivery_note_item_id || "", 80);
  if (!deliveryNoteItemId) return json({ ok: false, error: "Thieu ma dong giao hang" }, 400);
  const old = await getDeliveryNoteItemSQL(env.DB, deliveryNoteItemId);
  if (!old) return json({ ok: false, error: "Khong tim thay dong giao hang" }, 404);
  if (old.status === "archived") return json({ ok: false, error: "Dong da luu tru" }, 400);
  const now = nowIso();
  await archiveDeliveryNoteItemSQL(env.DB, deliveryNoteItemId, now);
  ctx.waitUntil(invalidateKv(env, DASHBOARD_KEYS));
  ctx.waitUntil(writeActionLog(env, {
    action: "archiveDeliveryNoteItem",
    entityType: "delivery_note_item",
    entityId: deliveryNoteItemId,
    oldJson: old,
    newJson: { ...old, status: "archived", archived_at: now, updated_at: now },
    actor
  }));
  return json({ ok: true });
}
__name(archiveItem3, "archiveItem");
async function buildDeliveryItem(db, p, now, oldItem = null) {
  const deliveryNoteId = cleanString(p.deliveryNoteId || p.delivery_note_id || oldItem?.delivery_note_id || "", 80);
  let rfqItemId = cleanString(p.rfqItemId || p.rfq_item_id || oldItem?.rfq_item_id || "", 80);
  let contractItemId = cleanString(p.contractItemId || p.contract_item_id || oldItem?.contract_item_id || "", 80) || null;
  let itemId = cleanString(p.itemId || p.item_id || oldItem?.item_id || "", 80) || null;
  let lineNo = cleanString(p.lineNo || p.line_no || oldItem?.line_no || "", 40);
  let maVatTu = cleanString(p.maVatTu || p.ma_vat_tu || oldItem?.ma_vat_tu || "", 120);
  let tenVatTu = cleanString(p.tenVatTu || p.ten_vat_tu || oldItem?.ten_vat_tu || "", 500);
  let model = cleanString(p.requiredModel || p.required_model || oldItem?.required_model || "", 400);
  let manufacturer = cleanString(p.manufacturer || oldItem?.manufacturer || "", 180);
  let brand = cleanString(p.brand || oldItem?.brand || "", 120);
  let origin = cleanString(p.originCountry || p.origin_country || oldItem?.origin_country || "", 120);
  let unit = cleanString(p.unit || oldItem?.unit || "", 40);
  if (contractItemId) {
    const ci = await getContractItemSQL(db, contractItemId);
    if (ci) {
      if (!rfqItemId) rfqItemId = ci.rfq_item_id || "";
      if (!itemId) itemId = ci.item_id || null;
      if (!lineNo) lineNo = cleanString(ci.line_no || "", 40);
      if (!maVatTu) maVatTu = cleanString(ci.ma_vat_tu || "", 120);
      if (!tenVatTu) tenVatTu = cleanString(ci.ten_vat_tu || "", 500);
      if (!model) model = cleanString(ci.required_model || "", 400);
      if (!manufacturer) manufacturer = cleanString(ci.manufacturer || "", 180);
      if (!brand) brand = cleanString(ci.brand || "", 120);
      if (!origin) origin = cleanString(ci.origin_country || "", 120);
      if (!unit) unit = cleanString(ci.unit || "", 40);
    }
  }
  if (rfqItemId) {
    const ri = await getRfqItemSQL(db, rfqItemId);
    if (ri) {
      if (!itemId) itemId = ri.item_id || null;
      if (!maVatTu) maVatTu = cleanString(ri.ma_vat_tu || "", 120);
      if (!tenVatTu) tenVatTu = cleanString(ri.ten_vat_tu || "", 500);
      if (!model) model = cleanString(ri.required_model || ri.quy_cach_model_yeu_cau || "", 400);
      if (!manufacturer) manufacturer = cleanString(ri.manufacturer || ri.hang_goc_nsx_goc || "", 180);
      if (!brand) brand = cleanString(ri.brand || ri.nhan_hieu || "", 120);
      if (!origin) origin = cleanString(ri.origin_country || ri.xuat_xu || "", 120);
      if (!unit) unit = cleanString(ri.unit || ri.don_vi || "", 40);
    }
  }
  const qty = cleanNumber(p.deliveredQuantity ?? p.delivered_quantity ?? oldItem?.delivered_quantity ?? 0);
  if (!deliveryNoteId || !rfqItemId || !tenVatTu || qty <= 0) return null;
  return {
    delivery_note_item_id: oldItem?.delivery_note_item_id || makeId("DNI"),
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
    note: cleanString(p.note || oldItem?.note || "", 2e3),
    status: oldItem?.status || "active",
    created_at: oldItem?.created_at || now,
    updated_at: now,
    archived_at: oldItem?.archived_at || null
  };
}
__name(buildDeliveryItem, "buildDeliveryItem");
async function deleteNote(request, env, ctx, actor) {
  if (!actor || actor.role !== "admin") return json({ ok: false, error: "Chi admin moi co the xoa phieu giao hang" }, 403);
  const body = await readJson(request);
  const deliveryNoteId = cleanString(body.deliveryNoteId || body.delivery_note_id || "", 80);
  if (!deliveryNoteId) return json({ ok: false, error: "Thieu ma phieu giao hang" }, 400);
  const note = await getDeliveryNoteSQL(env.DB, deliveryNoteId);
  if (!note) return json({ ok: false, error: "Khong tim thay phieu giao hang" }, 404);
  const hasActivity = note.acceptance_status && note.acceptance_status !== "pending" || note.payment_request_status && note.payment_request_status !== "not_ready";
  if (hasActivity) return json({ ok: false, error: "\u0110\u01A1n giao h\xE0ng \u0111\xE3 c\xF3 nghi\u1EC7m thu ho\u1EB7c thanh to\xE1n, kh\xF4ng th\u1EC3 x\xF3a." }, 400);
  const statuses = await getDeliveryNoteItemStatusesSQL(env.DB, deliveryNoteId);
  const itemHasActivity = statuses.some((r) => r.acceptance_status && r.acceptance_status !== "pending");
  if (itemHasActivity) return json({ ok: false, error: "\u0110\u01A1n giao h\xE0ng \u0111\xE3 c\xF3 nghi\u1EC7m thu ho\u1EB7c thanh to\xE1n, kh\xF4ng th\u1EC3 x\xF3a." }, 400);
  await deleteDeliveryNoteSQL(env.DB, deliveryNoteId);
  ctx.waitUntil(invalidateKv(env, DASHBOARD_KEYS));
  ctx.waitUntil(writeActionLog(env, {
    action: "deleteDeliveryNote",
    entityType: "delivery_note",
    entityId: deliveryNoteId,
    message: `Xoa vinh vien phieu giao hang ${note.delivery_note_no}`,
    oldJson: note,
    newJson: null,
    actor
  }));
  return json({ ok: true });
}
__name(deleteNote, "deleteNote");
async function previewNoteNo(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const noteType = VALID_NOTE_TYPES.has(body.noteType) ? body.noteType : "delivery";
  const deliveryDate = validateDate2(body.deliveryDate || "") || nowIso().slice(0, 10);
  const no = await nextDeliveryNoteNoSQL(env.DB, deliveryDate, noteType);
  return json({ ok: true, no });
}
__name(previewNoteNo, "previewNoteNo");
function validateDate2(value) {
  const s = cleanString(value || "", 20);
  return DATE_RE3.test(s) ? s : "";
}
__name(validateDate2, "validateDate");
function addDays(isoDate, days) {
  const d = /* @__PURE__ */ new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
__name(addDays, "addDays");
async function recordAcceptance(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const now = nowIso();
  const deliveryNoteId = cleanString(body.deliveryNoteId || body.delivery_note_id || "", 80);
  if (!deliveryNoteId) return json({ ok: false, error: "Thieu ma phieu giao hang" }, 400);
  const note = await getDeliveryNoteSQL(env.DB, deliveryNoteId);
  if (!note) return json({ ok: false, error: "Khong tim thay phieu giao hang" }, 404);
  if (note.status === "archived") return json({ ok: false, error: "Phieu da luu tru, khong sua duoc" }, 400);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return json({ ok: false, error: "Khong co dong vat tu nao" }, 400);
  const itemRows = [];
  for (const raw of rawItems) {
    const id = cleanString(raw.deliveryNoteItemId || raw.delivery_note_item_id || "", 80);
    if (!id) return json({ ok: false, error: "Thieu delivery_note_item_id" }, 400);
    const rawStatus = cleanString(raw.acceptanceStatus || raw.acceptance_status || "pending", 20);
    const itemStatus = VALID_ACCEPTANCE_ITEM_STATUSES.has(rawStatus) ? rawStatus : "pending";
    const acceptedQty = Math.max(0, cleanNumber(raw.acceptedQuantity ?? raw.accepted_quantity ?? 0));
    const warrantyDays = raw.warrantyDays != null ? Math.max(0, parseInt(raw.warrantyDays, 10) || 0) : null;
    const warrantyStart = validateDate2(raw.warrantyStartDate || raw.warranty_start_date || "");
    let warrantyEnd = validateDate2(raw.warrantyEndDate || raw.warranty_end_date || "");
    if (warrantyDays && warrantyStart && !warrantyEnd) warrantyEnd = addDays(warrantyStart, warrantyDays);
    itemRows.push({
      delivery_note_item_id: id,
      accepted_quantity: itemStatus === "rejected" ? 0 : acceptedQty,
      acceptance_status: itemStatus,
      rejection_reason: cleanString(raw.rejectionReason || raw.rejection_reason || "", 500) || null,
      warranty_days: warrantyDays || null,
      warranty_start_date: warrantyStart || null,
      warranty_end_date: warrantyEnd || null
    });
  }
  const existingStatuses = await getDeliveryNoteItemStatusesSQL(env.DB, deliveryNoteId);
  const submittedIds = new Set(itemRows.map((r) => r.delivery_note_item_id));
  const mergedStatuses = [
    ...existingStatuses.filter((r) => !submittedIds.has(r.delivery_note_item_id)).map((r) => ({ status: r.acceptance_status || "pending", qty: Number(r.accepted_quantity) || 0 })),
    ...itemRows.map((r) => ({ status: r.acceptance_status, qty: Number(r.accepted_quantity) || 0 }))
  ];
  const allAccepted = mergedStatuses.every((r) => r.status === "accepted");
  const allRejected = mergedStatuses.every((r) => r.status === "rejected");
  const anyPending = mergedStatuses.some((r) => r.status === "pending");
  let headerStatus = anyPending ? "pending" : allAccepted ? "accepted" : allRejected ? "rejected" : "partial";
  const acceptanceDate = validateDate2(body.acceptanceDate || body.acceptance_date || "") || now.slice(0, 10);
  const totalAccepted = mergedStatuses.reduce((s, r) => s + r.qty, 0);
  const paymentStatus = (headerStatus === "accepted" || headerStatus === "partial") && totalAccepted > 0 ? "ready" : "not_ready";
  const header = {
    acceptance_date: acceptanceDate,
    acceptance_status: headerStatus,
    acceptance_note: cleanString(body.acceptanceNote || body.acceptance_note || "", 2e3) || null,
    payment_request_status: paymentStatus,
    payment_request_date: paymentStatus === "ready" ? acceptanceDate : null
  };
  await recordAcceptanceSQL(env.DB, deliveryNoteId, header, itemRows, now);
  ctx.waitUntil(invalidateKv(env, DASHBOARD_KEYS));
  ctx.waitUntil(writeActionLog(env, {
    action: "recordDeliveryAcceptance",
    entityType: "delivery_note",
    entityId: deliveryNoteId,
    message: `Ghi nghiem thu phieu ${note.delivery_note_no}: ${headerStatus}, ${totalAccepted} SL da NT`,
    oldJson: note,
    newJson: { ...header, deliveryNoteId, itemCount: itemRows.length },
    actor
  }));
  return json({ ok: true, acceptanceStatus: headerStatus, paymentRequestStatus: paymentStatus });
}
__name(recordAcceptance, "recordAcceptance");

// src/worker/db/dashboard-queries.js
function todayVN() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1e3);
  return d.toISOString().slice(0, 10);
}
__name(todayVN, "todayVN");
function vnDateAdd(days) {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1e3 + days * 864e5);
  return d.toISOString().slice(0, 10);
}
__name(vnDateAdd, "vnDateAdd");
async function getDashboardV2SQL(db) {
  const today = todayVN();
  const d3 = vnDateAdd(3);
  const d7 = vnDateAdd(7);
  const tomorrow = vnDateAdd(1);
  const ago7 = vnDateAdd(-7);
  const ago30 = vnDateAdd(-30);
  const [
    // ── original 0-22 ──────────────────────────────────────────────────────────
    rfqTotal,
    rfqOpen,
    rfqDueSoon,
    rfqOverdue,
    itemTotal,
    itemsWithQuotes,
    itemsWithMaster,
    quoteTotal,
    quoteLast7,
    quoteLast30,
    contractActive,
    contractLast30,
    contractValue,
    masterTotal,
    clarPending,
    importErrSum,
    newestRfqs,
    quotesByChannel,
    topSuppliers,
    latestClar,
    latestJobs,
    latestContracts,
    topMaster,
    // ── new 23-37 ──────────────────────────────────────────────────────────────
    rfqDkqTotal,
    rfqDkqDue3,
    rfqDkqOverdue,
    rfqTrungCount,
    rfqTrungValue,
    rfqTrungItemCount,
    rfqThamKhaoCount,
    rfqThamKhaoValue,
    clarByStatus,
    trackedList,
    wonList,
    clarLatest30,
    taskSummaryRow,
    topTasks,
    followupList
  ] = await Promise.all([
    // ── RFQ counts (0-3) ──────────────────────────────────────────────────────
    db.prepare("SELECT COUNT(*) AS n FROM rfqs").first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi IN ('dang_khao_gia','treo')"
    ).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi IN ('dang_khao_gia','treo') AND ngay_het_han >= ? AND ngay_het_han <= ? AND ngay_het_han != ''"
    ).bind(today, d7).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi IN ('dang_khao_gia','treo') AND ngay_het_han < ? AND ngay_het_han != ''"
    ).bind(today).first(),
    // ── Item counts (4-6) ─────────────────────────────────────────────────────
    db.prepare("SELECT COUNT(*) AS n FROM rfq_items").first(),
    db.prepare(
      "SELECT COUNT(DISTINCT rfq_item_id) AS n FROM supplier_quotes WHERE status = 'active'"
    ).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfq_items WHERE item_id IS NOT NULL AND item_id != ''"
    ).first(),
    // ── Quote counts (7-9) ────────────────────────────────────────────────────
    db.prepare("SELECT COUNT(*) AS n FROM supplier_quotes WHERE status = 'active'").first(),
    db.prepare("SELECT COUNT(*) AS n FROM supplier_quotes WHERE created_at >= ?").bind(ago7).first(),
    db.prepare("SELECT COUNT(*) AS n FROM supplier_quotes WHERE created_at >= ?").bind(ago30).first(),
    // ── Contract counts/sum (10-12) ───────────────────────────────────────────
    db.prepare("SELECT COUNT(*) AS n FROM contracts WHERE status = 'active'").first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM contracts WHERE status = 'active' AND COALESCE(signed_date, created_at) >= ?"
    ).bind(ago30).first(),
    db.prepare(
      "SELECT COALESCE(SUM(contract_total), 0) AS n FROM contracts WHERE status = 'active'"
    ).first(),
    // ── Master item count (13) ────────────────────────────────────────────────
    db.prepare("SELECT COUNT(*) AS n FROM items WHERE status = 'active'").first(),
    // ── Clarification pending (14) ────────────────────────────────────────────
    db.prepare(
      "SELECT COUNT(*) AS n FROM technical_clarifications WHERE deleted_at IS NULL AND status_after IN ('waiting_supplier','waiting_client','need_more_info')"
    ).first(),
    // ── Import error sum (15) ─────────────────────────────────────────────────
    db.prepare(
      "SELECT COALESCE(SUM(error_count), 0) AS n FROM import_jobs WHERE created_at >= ?"
    ).bind(ago30).first(),
    // ── Lists (16-22) ─────────────────────────────────────────────────────────
    db.prepare(
      "SELECT rfq_id, ma_goi_tbmt, ten_goi, trang_thai_goi, ngay_het_han, created_at FROM rfqs ORDER BY created_at DESC, rfq_id DESC LIMIT 5"
    ).all(),
    db.prepare(
      "SELECT COALESCE(source_channel,'unknown') AS channel, COUNT(*) AS cnt FROM supplier_quotes WHERE status = 'active' GROUP BY source_channel ORDER BY cnt DESC"
    ).all(),
    db.prepare(
      "SELECT supplier_name AS name, COUNT(*) AS cnt FROM supplier_quotes WHERE status = 'active' AND supplier_name IS NOT NULL AND supplier_name != '' GROUP BY supplier_name ORDER BY cnt DESC LIMIT 5"
    ).all(),
    db.prepare(
      "SELECT clarification_id, title, status_after, clarification_type, created_at, rfq_item_id FROM technical_clarifications WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5"
    ).all(),
    db.prepare(
      "SELECT job_id, rfq_id, source_file_name, status, total_rows, created_count, updated_count, error_count, created_at FROM import_jobs ORDER BY created_at DESC LIMIT 5"
    ).all(),
    db.prepare(
      "SELECT contract_id, contract_no, contract_name, signed_date, contract_total, currency, created_at FROM contracts WHERE status = 'active' ORDER BY COALESCE(signed_date, created_at) DESC, contract_id DESC LIMIT 5"
    ).all(),
    db.prepare(
      "SELECT i.item_id, i.ten_vat_tu, i.ma_vat_tu, COUNT(sq.quote_id) AS quote_count FROM items i JOIN rfq_items ri ON ri.item_id = i.item_id JOIN supplier_quotes sq ON sq.rfq_item_id = ri.rfq_item_id AND sq.status = 'active' WHERE i.status = 'active' GROUP BY i.item_id ORDER BY quote_count DESC LIMIT 5"
    ).all(),
    // ── NEW: dang_khao_gia KPI counts (23-25) ─────────────────────────────────
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi = 'dang_khao_gia'"
    ).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi = 'dang_khao_gia' AND ngay_het_han IS NOT NULL AND ngay_het_han != '' AND ngay_het_han >= ? AND ngay_het_han <= ?"
    ).bind(today, d3).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi = 'dang_khao_gia' AND ngay_het_han IS NOT NULL AND ngay_het_han != '' AND ngay_het_han < ?"
    ).bind(today).first(),
    // ── NEW: trung KPI counts (26-28) ─────────────────────────────────────────
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi = 'trung'"
    ).first(),
    db.prepare(
      "SELECT COALESCE(SUM(du_toan), 0) AS n FROM rfqs WHERE trang_thai_goi = 'trung'"
    ).first(),
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfq_items i WHERE EXISTS (SELECT 1 FROM rfqs r WHERE r.rfq_id = i.rfq_id AND r.trang_thai_goi = 'trung')"
    ).first(),
    // ── NEW: tham_khao KPI counts (29-30) ─────────────────────────────────────
    db.prepare(
      "SELECT COUNT(*) AS n FROM rfqs WHERE trang_thai_goi = 'tham_khao'"
    ).first(),
    db.prepare(
      "SELECT COALESCE(SUM(du_toan), 0) AS n FROM rfqs WHERE trang_thai_goi = 'tham_khao'"
    ).first(),
    // ── NEW: clarification breakdown by status (31) ───────────────────────────
    db.prepare(
      "SELECT SUM(CASE WHEN status_after='waiting_supplier' THEN 1 ELSE 0 END) AS waiting_supplier, SUM(CASE WHEN status_after='waiting_client'   THEN 1 ELSE 0 END) AS waiting_client, SUM(CASE WHEN status_after='need_more_info'   THEN 1 ELSE 0 END) AS need_more_info, SUM(CASE WHEN status_after='processing'       THEN 1 ELSE 0 END) AS processing FROM technical_clarifications WHERE deleted_at IS NULL AND status_after IN ('waiting_supplier','waiting_client','need_more_info','processing')"
    ).first(),
    // ── NEW: tracked RFQ list – dang_khao_gia + tham_khao + da_bao, top 30 (32) ──
    db.prepare(
      "SELECT r.rfq_id, r.ma_goi_tbmt, r.ten_goi, r.ngay_het_han, r.trang_thai_goi, r.du_toan, r.external_url, r.client_id, COALESCE(c.client_name, r.nha_may_cdt, '') AS cdt_label, (SELECT COUNT(*) FROM rfq_items i WHERE i.rfq_id = r.rfq_id AND i.trang_thai_dong != 'archived') AS item_count FROM rfqs r LEFT JOIN clients c ON c.client_id = r.client_id WHERE r.trang_thai_goi IN ('dang_khao_gia','tham_khao','da_bao') ORDER BY CASE WHEN r.ngay_het_han IS NULL OR r.ngay_het_han = '' THEN 2      WHEN r.ngay_het_han >= ? THEN 0 ELSE 1 END ASC, CASE WHEN r.ngay_het_han >= ? THEN r.ngay_het_han ELSE '0' END ASC, CASE WHEN r.ngay_het_han < ? AND r.ngay_het_han IS NOT NULL AND r.ngay_het_han != '' THEN r.ngay_het_han ELSE '9' END DESC LIMIT 30"
    ).bind(today, today, today).all(),
    // ── NEW: won RFQ list with item count, sorted by updated_at DESC (33) ─────
    db.prepare(
      "SELECT r.rfq_id, r.ma_goi_tbmt, r.ten_goi, r.du_toan, r.updated_at, r.external_url, r.client_id, (SELECT COUNT(*) FROM rfq_items i WHERE i.rfq_id = r.rfq_id) AS item_count FROM rfqs r WHERE r.trang_thai_goi = 'trung' ORDER BY r.updated_at DESC, r.rfq_id DESC LIMIT 15"
    ).all(),
    // ── NEW: latest 30 clarifications with rfq_item + rfq names, exclude SMOKE (34) ──
    db.prepare(
      "SELECT tc.clarification_id, tc.rfq_item_id, tc.clarification_type, tc.status_after, tc.title, tc.proposed_model, tc.proposed_manufacturer, tc.proposed_origin, tc.created_at, tc.external_url AS clar_url, i.ten_vat_tu, i.ma_vat_tu, i.external_url AS item_url, r.rfq_id, r.ten_goi, r.ma_goi_tbmt, r.external_url AS rfq_url FROM technical_clarifications tc JOIN rfq_items i ON i.rfq_item_id = tc.rfq_item_id JOIN rfqs r ON r.rfq_id = i.rfq_id WHERE tc.deleted_at IS NULL AND UPPER(r.rfq_id) NOT LIKE '%SMOKE%' AND UPPER(COALESCE(r.ten_goi,'')) NOT LIKE '%SMOKE%' ORDER BY tc.created_at DESC LIMIT 30"
    ).all(),
    // ── NEW: task summary inline (35) ─────────────────────────────────────────
    db.prepare(
      "SELECT SUM(CASE WHEN status='dang_lam'     THEN 1 ELSE 0 END) AS dang_lam, SUM(CASE WHEN status='cho_phan_hoi' THEN 1 ELSE 0 END) AS cho_phan_hoi, SUM(CASE WHEN deadline_date IS NOT NULL AND deadline_date < ?          AND status NOT IN ('hoan_thanh','huy_bo') THEN 1 ELSE 0 END) AS qua_han, SUM(CASE WHEN deadline_date IS NOT NULL AND deadline_date >= ? AND deadline_date <= ?          AND status NOT IN ('hoan_thanh','huy_bo') THEN 1 ELSE 0 END) AS sap_den_han FROM tasks WHERE deleted_at IS NULL"
    ).bind(today, today, d7).first(),
    // ── NEW: top 20 active tasks sorted by urgency/priority (36) ─────────────
    db.prepare(
      "SELECT task_id, title, company_name, deadline_date, next_followup_date, status, priority, latest_note FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('hoan_thanh','huy_bo') ORDER BY CASE WHEN deadline_date IS NOT NULL AND deadline_date < ? THEN 0 ELSE 1 END ASC, CASE priority WHEN 'khan' THEN 0 WHEN 'cao' THEN 1 WHEN 'trung_binh' THEN 2 ELSE 3 END ASC, COALESCE(deadline_date,'9999') ASC, COALESCE(last_activity_at,created_at) DESC LIMIT 20"
    ).bind(today).all(),
    // ── NEW: follow-up tasks — deadline within next 7 days (incl. overdue) (37) ──
    db.prepare(
      "SELECT task_id, title, company_name, deadline_date, next_followup_date, status, priority, latest_note, created_by FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('hoan_thanh','huy_bo') AND deadline_date IS NOT NULL AND deadline_date != '' AND deadline_date <= ? ORDER BY deadline_date ASC, task_id ASC LIMIT 20"
    ).bind(d7).all()
  ]);
  const scalar = /* @__PURE__ */ __name((row) => row?.n || 0, "scalar");
  const list = /* @__PURE__ */ __name((res) => res?.results || [], "list");
  const iTotal = scalar(itemTotal);
  const iQuotes = scalar(itemsWithQuotes);
  const iMaster = scalar(itemsWithMaster);
  return {
    rfq: {
      // original fields kept for compat
      total: scalar(rfqTotal),
      open: scalar(rfqOpen),
      due_soon: scalar(rfqDueSoon),
      overdue: scalar(rfqOverdue),
      newest: list(newestRfqs),
      // new command-center fields
      dkq_total: scalar(rfqDkqTotal),
      dkq_due3: scalar(rfqDkqDue3),
      dkq_overdue: scalar(rfqDkqOverdue),
      trung_count: scalar(rfqTrungCount),
      trung_value: scalar(rfqTrungValue),
      trung_item_count: scalar(rfqTrungItemCount),
      tham_khao_count: scalar(rfqThamKhaoCount),
      tham_khao_value: scalar(rfqThamKhaoValue),
      tracked_list: list(trackedList),
      won_list: list(wonList)
    },
    items: {
      total: iTotal,
      with_quotes: iQuotes,
      without_quotes: Math.max(0, iTotal - iQuotes),
      quote_coverage_pct: iTotal > 0 ? Math.round(iQuotes / iTotal * 100) : 0,
      with_master_link: iMaster,
      master_link_pct: iTotal > 0 ? Math.round(iMaster / iTotal * 100) : 0
    },
    quotes: {
      total: scalar(quoteTotal),
      last_7_days: scalar(quoteLast7),
      last_30_days: scalar(quoteLast30),
      by_channel: list(quotesByChannel),
      top_suppliers: list(topSuppliers)
    },
    clarifications: {
      // original field kept
      pending: scalar(clarPending),
      latest: list(latestClar),
      // new breakdown
      by_status: {
        waiting_supplier: Number(clarByStatus?.waiting_supplier || 0),
        waiting_client: Number(clarByStatus?.waiting_client || 0),
        need_more_info: Number(clarByStatus?.need_more_info || 0),
        processing: Number(clarByStatus?.processing || 0)
      },
      latest30: list(clarLatest30)
    },
    imports: {
      latest_jobs: list(latestJobs),
      error_count_last_30_days: scalar(importErrSum)
    },
    contracts: {
      active: scalar(contractActive),
      last_30_days: scalar(contractLast30),
      total_value_active: scalar(contractValue),
      latest: list(latestContracts)
    },
    master_items: {
      total: scalar(masterTotal),
      top_by_quote_count: list(topMaster)
    },
    tasks: {
      summary: {
        dang_lam: Number(taskSummaryRow?.dang_lam || 0),
        cho_phan_hoi: Number(taskSummaryRow?.cho_phan_hoi || 0),
        qua_han: Number(taskSummaryRow?.qua_han || 0),
        sap_den_han: Number(taskSummaryRow?.sap_den_han || 0)
      },
      top20: list(topTasks),
      followup: list(followupList)
    }
  };
}
__name(getDashboardV2SQL, "getDashboardV2SQL");

// src/worker/handlers/dashboard.js
var CACHE_KEY = "dashboard:v2";
var CACHE_TTL = 300;
async function handleDashboard(action, request, env, ctx, actor) {
  if (action === "getDashboardV2") return getDashboardV2(request, env, actor);
  return json({ ok: false, error: "Unknown dashboard action" }, 400);
}
__name(handleDashboard, "handleDashboard");
async function getDashboardV2(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const force = body.force === true || body.force === "1" || body.force === "true";
  if (!force) {
    const cached = await getKv(env, CACHE_KEY);
    if (cached) return json({ ok: true, data: cached });
  }
  const data = await getDashboardV2SQL(env.DB);
  await setKv(env, CACHE_KEY, data, CACHE_TTL);
  return json({ ok: true, data });
}
__name(getDashboardV2, "getDashboardV2");

// src/worker/handlers/ocr.js
var MAX_BYTES = 8 * 1024 * 1024;
var VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
async function handleOcr(action, request, env, _ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  if (!env.AI) {
    return json({
      ok: false,
      error: 'OCR ch\u01B0a c\u1EA5u h\xECnh. Th\xEAm [ai] binding = "AI" v\xE0o wrangler.toml r\u1ED3i ch\u1EA1y wrangler deploy.'
    }, 503);
  }
  const form = await request.formData().catch(() => null);
  if (!form) return json({ ok: false, error: "Kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c form" }, 400);
  const file = form.get("file");
  const mode = cleanString(form.get("mode") || "item", 20);
  if (!file || typeof file.arrayBuffer !== "function") {
    return json({ ok: false, error: "Thi\u1EBFu file \u1EA3nh" }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ ok: false, error: "File qu\xE1 l\u1EDBn (t\u1ED1i \u0111a 8MB)" }, 400);
  }
  const bytes = await file.arrayBuffer();
  const mime = detectMime(bytes);
  if (mime === "pdf") {
    return json({ ok: false, error: "Phase 1 ch\u01B0a h\u1ED7 tr\u1EE3 PDF \u2014 vui l\xF2ng ch\u1EE5p \u1EA3nh ho\u1EB7c chuy\u1EC3n sang JPEG/PNG." }, 400);
  }
  if (mime === "unknown") {
    return json({ ok: false, error: "\u0110\u1ECBnh d\u1EA1ng kh\xF4ng h\u1EE3p l\u1EC7. Ch\u1EA5p nh\u1EADn JPEG, PNG, WebP." }, 400);
  }
  let rawText = "";
  try {
    const resp = await env.AI.run(VISION_MODEL, {
      prompt: buildPrompt(mode),
      image: [...new Uint8Array(bytes)]
    });
    rawText = resp && resp.response ? String(resp.response) : "";
  } catch (err) {
    return json({ ok: false, error: "L\u1ED7i OCR: " + (err.message || String(err)) }, 500);
  }
  if (mode === "item") {
    const rows = extractTableRows(rawText);
    return json({ ok: true, mode, kind: "table", rows, rawText });
  }
  const mapped = extractJson(rawText);
  return json({ ok: true, mapped, rawText, mode });
}
__name(handleOcr, "handleOcr");
function buildPrompt(mode) {
  if (mode === "rfq") {
    return 'Extract procurement package information from this image. Return ONLY a valid JSON object, no extra text:\n{"tenGoi":"package name","maGoiTbmt":"package or tender code","nhaMayCdt":"owner or client company name","ngayNhanHoacDangTai":"YYYY-MM-DD or empty string","ngayHetHan":"YYYY-MM-DD or empty string","duToan":"budget number only or empty string","note":"any other relevant details"}';
  }
  if (mode === "supplier") {
    return 'Extract contact information from this business card image. Return ONLY a valid JSON object, no extra text:\n{"supplierName":"company name","contactName":"person full name","phone":"phone number","email":"email address","country":"country","zalo":"Zalo number if present or empty string","wechat":"WeChat ID if present or empty string","note":"job title, address, website, and any other info concatenated as one string"}';
  }
  return 'Extract ALL material rows from the procurement table in this image. Chinese header mapping: \u5E8F\u53F7\u2192sttGoc, \u7269\u8D44\u7F16\u7801\u2192maVatTu, \u7269\u8D44\u540D\u79F0\u2192tenVatTu, \u89C4\u683C\u578B\u53F7\u2192requiredModel, \u5355\u4F4D\u2192unit, \u6570\u91CF\u2192quantity. Return ONLY valid JSON. No markdown. No explanation.\n{"rows":[{"sttGoc":"","maVatTu":"","tenVatTu":"","requiredModel":"","unit":"","quantity":""}]}';
}
__name(buildPrompt, "buildPrompt");
function extractJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text.trim());
  } catch (_) {
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {
    }
  }
  return {};
}
__name(extractJson, "extractJson");
function extractTableRows(text) {
  if (!text) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(text.trim());
  } catch (_) {
  }
  if (!parsed) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch (_) {
      }
    }
  }
  if (!parsed) return [];
  const rawRows = Array.isArray(parsed.rows) ? parsed.rows : Array.isArray(parsed) ? parsed : [];
  return rawRows.filter((r) => r && typeof r === "object").map((r) => ({
    sttGoc: String(r.sttGoc ?? r["\u5E8F\u53F7"] ?? "").trim(),
    maVatTu: String(r.maVatTu ?? r["\u7269\u8D44\u7F16\u7801"] ?? "").trim(),
    tenVatTu: String(r.tenVatTu ?? r["\u7269\u8D44\u540D\u79F0"] ?? "").trim(),
    requiredModel: String(r.requiredModel ?? r["\u89C4\u683C\u578B\u53F7"] ?? "").trim(),
    unit: String(r.unit ?? r["\u5355\u4F4D"] ?? "").trim(),
    quantity: String(r.quantity ?? r["\u6570\u91CF"] ?? "").trim(),
    rawRow: r
  }));
}
__name(extractTableRows, "extractTableRows");
function detectMime(buffer) {
  const b = new Uint8Array(buffer);
  if (b.length >= 4 && b[0] === 37 && b[1] === 80 && b[2] === 68 && b[3] === 70) return "pdf";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return "jpeg";
  if (b.length >= 8 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) return "png";
  if (b.length >= 12 && b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70 && b[8] === 87 && b[9] === 69 && b[10] === 66 && b[11] === 80) return "webp";
  return "unknown";
}
__name(detectMime, "detectMime");

// src/worker/db/task-queries.js
async function nextTaskId(db) {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1e3);
  const yyyy = d.toISOString().slice(0, 4);
  const mmdd = d.toISOString().slice(5, 10).replace("-", "");
  const prefix = `Task-${yyyy}-${mmdd}`;
  const row = await db.prepare(
    `SELECT task_id FROM tasks WHERE task_id LIKE ? ORDER BY task_id DESC LIMIT 1`
  ).bind(`${prefix}-%`).first();
  const last = row?.task_id ? Number(row.task_id.split("-").pop()) : 0;
  const seq = (Number.isFinite(last) ? last : 0) + 1;
  return `${prefix}-${String(seq).padStart(2, "0")}`;
}
__name(nextTaskId, "nextTaskId");
function parseCursor7(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf("|||");
  return idx === -1 ? { pk: cursor, sortVal: void 0 } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}
__name(parseCursor7, "parseCursor");
var TASK_SORT = {
  title: { col: "title", rowKey: "title" },
  deadline_date: { col: "deadline_date", rowKey: "deadline_date" },
  priority: { col: "priority", rowKey: "priority" },
  status: { col: "status", rowKey: "status" },
  company_name: { col: "company_name", rowKey: "company_name" },
  created_at: { col: "created_at", rowKey: "created_at" },
  last_activity_at: { col: "last_activity_at", rowKey: "last_activity_at" }
};
async function listTasksSQL(db, { q, company, status, priority, cursor, sortBy, sortDir, limit }) {
  const sort = TASK_SORT[sortBy] || null;
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const op = dir === "ASC" ? ">" : "<";
  const binds = [];
  const where = ["deleted_at IS NULL"];
  if (q) {
    where.push("(company_normalized LIKE ? OR title LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (company) {
    where.push("company_normalized LIKE ?");
    binds.push(`%${company}%`);
  }
  if (status) {
    where.push("status = ?");
    binds.push(status);
  }
  if (priority) {
    where.push("priority = ?");
    binds.push(priority);
  }
  if (cursor) {
    const c = parseCursor7(cursor);
    if (!sort) {
      if (c.sortVal !== void 0) {
        where.push(
          "(COALESCE(last_activity_at,created_at) < ? OR (COALESCE(last_activity_at,created_at) = ? AND task_id < ?))"
        );
        binds.push(c.sortVal, c.sortVal, c.pk);
      }
    } else {
      const wrap = `COALESCE(${sort.col},'')`;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND task_id ${op} ?))`);
      binds.push(c.sortVal, c.sortVal, c.pk);
    }
  }
  const orderBy = sort ? `${sort.col} ${dir}, task_id ${dir}` : "COALESCE(last_activity_at,created_at) DESC, task_id DESC";
  const res = await db.prepare(
    `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    if (sort) {
      nextCursor = String(last[sort.rowKey] ?? "") + "|||" + last.task_id;
    } else {
      nextCursor = String(last.last_activity_at ?? last.created_at ?? "") + "|||" + last.task_id;
    }
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor };
}
__name(listTasksSQL, "listTasksSQL");
async function getTasksSummarySQL(db) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const in7days = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const res = await db.prepare(`
    SELECT
      SUM(CASE WHEN status='dang_lam'     THEN 1 ELSE 0 END) AS dang_lam,
      SUM(CASE WHEN status='cho_phan_hoi' THEN 1 ELSE 0 END) AS cho_phan_hoi,
      SUM(CASE WHEN deadline_date IS NOT NULL AND deadline_date < ?
               AND status NOT IN ('hoan_thanh','huy_bo') THEN 1 ELSE 0 END) AS qua_han,
      SUM(CASE WHEN deadline_date IS NOT NULL AND deadline_date >= ? AND deadline_date <= ?
               AND status NOT IN ('hoan_thanh','huy_bo') THEN 1 ELSE 0 END) AS sap_den_han
    FROM tasks WHERE deleted_at IS NULL
  `).bind(today, today, in7days).first();
  return {
    dang_lam: Number(res?.dang_lam || 0),
    cho_phan_hoi: Number(res?.cho_phan_hoi || 0),
    qua_han: Number(res?.qua_han || 0),
    sap_den_han: Number(res?.sap_den_han || 0)
  };
}
__name(getTasksSummarySQL, "getTasksSummarySQL");
async function getTaskSQL(db, taskId) {
  return db.prepare("SELECT * FROM tasks WHERE task_id = ? AND deleted_at IS NULL").bind(taskId).first();
}
__name(getTaskSQL, "getTaskSQL");
async function insertTaskSQL(db, row) {
  return db.prepare(
    `INSERT INTO tasks (
      task_id, company_name, company_normalized, title, description,
      start_date, deadline_date, next_followup_date,
      status, priority, progress_percent, task_type,
      latest_note, completed_at, last_activity_at,
      created_by, created_at, updated_at, deleted_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`
  ).bind(
    row.task_id,
    row.company_name,
    row.company_normalized,
    row.title,
    row.description,
    row.start_date,
    row.deadline_date,
    row.next_followup_date,
    row.status,
    row.priority,
    row.progress_percent,
    row.task_type,
    row.latest_note,
    row.completed_at,
    row.last_activity_at,
    row.created_by,
    row.created_at,
    row.updated_at
  ).run();
}
__name(insertTaskSQL, "insertTaskSQL");
async function updateTaskSQL(db, row) {
  return db.prepare(
    `UPDATE tasks SET
      company_name=?, company_normalized=?, title=?, description=?,
      deadline_date=?, next_followup_date=?,
      status=?, priority=?, progress_percent=?, task_type=?,
      latest_note=?, completed_at=?, last_activity_at=?, updated_at=?
     WHERE task_id=? AND deleted_at IS NULL`
  ).bind(
    row.company_name,
    row.company_normalized,
    row.title,
    row.description,
    row.deadline_date,
    row.next_followup_date,
    row.status,
    row.priority,
    row.progress_percent,
    row.task_type,
    row.latest_note,
    row.completed_at,
    row.last_activity_at,
    row.updated_at,
    row.task_id
  ).run();
}
__name(updateTaskSQL, "updateTaskSQL");
async function softDeleteTaskSQL(db, taskId, now) {
  return db.prepare("UPDATE tasks SET deleted_at=?, updated_at=? WHERE task_id=?").bind(now, now, taskId).run();
}
__name(softDeleteTaskSQL, "softDeleteTaskSQL");
async function quickUpdateTaskStatusSQL(db, taskId, status, completedAt, now) {
  return db.prepare(
    `UPDATE tasks SET status=?, completed_at=?, last_activity_at=?, updated_at=?
     WHERE task_id=? AND deleted_at IS NULL`
  ).bind(status, completedAt, now, now, taskId).run();
}
__name(quickUpdateTaskStatusSQL, "quickUpdateTaskStatusSQL");
async function quickUpdateTaskPrioritySQL(db, taskId, priority, now) {
  return db.prepare(
    `UPDATE tasks SET priority=?, last_activity_at=?, updated_at=?
     WHERE task_id=? AND deleted_at IS NULL`
  ).bind(priority, now, now, taskId).run();
}
__name(quickUpdateTaskPrioritySQL, "quickUpdateTaskPrioritySQL");
async function suggestTaskCompaniesSQL(db, q, limit) {
  const res = await db.prepare(
    `SELECT DISTINCT company_name FROM tasks
     WHERE deleted_at IS NULL AND company_normalized LIKE ?
     ORDER BY company_name ASC LIMIT ?`
  ).bind(`${q}%`, limit).all();
  return (res.results || []).map((r) => r.company_name).filter(Boolean);
}
__name(suggestTaskCompaniesSQL, "suggestTaskCompaniesSQL");

// src/worker/handlers/tasks.js
var DASHBOARD_CACHE_KEY = "dashboard:v2";
var VALID_STATUS2 = /* @__PURE__ */ new Set(["dang_lam", "cho_phan_hoi", "tam_dung", "hoan_thanh", "huy_bo"]);
var VALID_PRIORITY = /* @__PURE__ */ new Set(["khan", "cao", "trung_binh", "thap"]);
async function handleTasks(action, request, env, ctx, actor) {
  if (action === "getTasks") return listTasks(request, env, actor);
  if (action === "getTask") return getOneTask(request, env, actor);
  if (action === "createTask") return saveTask(request, env, ctx, actor, false);
  if (action === "updateTask") return saveTask(request, env, ctx, actor, true);
  if (action === "deleteTask") return deleteTask(request, env, ctx, actor);
  if (action === "quickUpdateTaskStatus") return quickUpdateStatus(request, env, ctx, actor);
  if (action === "quickUpdateTaskPriority") return quickUpdatePriority(request, env, ctx, actor);
  if (action === "suggestTaskCompanies") return suggestCompanies(request, env, actor);
  return json({ ok: false, error: "Unknown task action" }, 400);
}
__name(handleTasks, "handleTasks");
async function getOneTask(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const taskId = p.taskId || p.task_id || "";
  if (!taskId) return json({ ok: false, error: "Missing taskId" }, 400);
  const row = await getTaskSQL(env.DB, taskId);
  if (!row) return json({ ok: false, error: "Task not found" }, 404);
  return json({ ok: true, row });
}
__name(getOneTask, "getOneTask");
async function listTasks(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const limit = clampLimit(p.limit);
  const [data, summary] = await Promise.all([
    listTasksSQL(env.DB, {
      q: normalizeText(p.q),
      company: normalizeText(p.company),
      status: p.status || "",
      priority: p.priority || "",
      cursor: p.cursor || "",
      sortBy: p.sortBy || "",
      sortDir: p.sortDir || "",
      limit
    }),
    getTasksSummarySQL(env.DB)
  ]);
  return json({ ok: true, ...data, summary });
}
__name(listTasks, "listTasks");
async function saveTask(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const title = cleanString(body.title || "", 300);
  if (!title) return json({ ok: false, error: "T\xEAn task l\xE0 b\u1EAFt bu\u1ED9c" }, 400);
  const now = nowIso();
  const todayDate = now.slice(0, 10);
  const taskId = isUpdate ? cleanString(body.taskId || body.task_id, 50) : null;
  const oldRow = isUpdate ? await getTaskSQL(env.DB, taskId) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: "Kh\xF4ng t\xECm th\u1EA5y task" }, 404);
  const companyName = cleanString(body.companyName || body.company_name || "", 200);
  const status = VALID_STATUS2.has(body.status) ? body.status : oldRow?.status || "dang_lam";
  const priority = VALID_PRIORITY.has(body.priority) ? body.priority : oldRow?.priority || "trung_binh";
  const progressRaw = Number(body.progressPercent ?? body.progress_percent ?? oldRow?.progress_percent ?? 0);
  const progressPercent = Math.min(100, Math.max(0, Number.isFinite(progressRaw) ? Math.trunc(progressRaw) : 0));
  let completedAt = oldRow?.completed_at || null;
  if (status === "hoan_thanh" && !completedAt) completedAt = now;
  if (status !== "hoan_thanh") completedAt = null;
  const row = {
    task_id: isUpdate ? oldRow.task_id : await nextTaskId(env.DB),
    company_name: companyName,
    company_normalized: normalizeText(companyName),
    title,
    description: cleanString(body.description || "", 2e3),
    // start_date is always backend-generated on create; on update keep existing value
    start_date: isUpdate ? oldRow.start_date || todayDate : todayDate,
    deadline_date: cleanString(body.deadlineDate || body.deadline_date || "", 10) || null,
    next_followup_date: cleanString(body.nextFollowupDate || body.next_followup_date || "", 10) || null,
    status,
    priority,
    progress_percent: progressPercent,
    task_type: cleanString(body.taskType || body.task_type || "", 100),
    latest_note: cleanString(body.latestNote || body.latest_note || "", 1e3),
    completed_at: completedAt,
    last_activity_at: now,
    created_by: isUpdate ? oldRow.created_by : actor?.id || "",
    created_at: oldRow?.created_at || now,
    updated_at: now
  };
  if (isUpdate) await updateTaskSQL(env.DB, row);
  else await insertTaskSQL(env.DB, row);
  await invalidateKv(env, [DASHBOARD_CACHE_KEY]);
  const taskLabel = row.company_name ? `"${row.title}" \u2014 ${row.company_name}` : `"${row.title}"`;
  ctx.waitUntil(writeActionLog(env, {
    action: isUpdate ? "updateTask" : "createTask",
    entityType: "task",
    entityId: row.task_id,
    message: isUpdate ? `C\u1EADp nh\u1EADt task: ${taskLabel}` : `T\u1EA1o task m\u1EDBi: ${taskLabel}`,
    oldJson: oldRow,
    newJson: row,
    actor
  }));
  return json({ ok: true, task: row });
}
__name(saveTask, "saveTask");
async function deleteTask(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const taskId = cleanString(body.taskId || body.task_id, 50);
  if (!taskId) return json({ ok: false, error: "Thi\u1EBFu task_id" }, 400);
  const row = await getTaskSQL(env.DB, taskId);
  if (!row) return json({ ok: false, error: "Kh\xF4ng t\xECm th\u1EA5y task" }, 404);
  const now = nowIso();
  await softDeleteTaskSQL(env.DB, taskId, now);
  const deletedLabel = row.company_name ? `"${row.title}" \u2014 ${row.company_name}` : `"${row.title}"`;
  ctx.waitUntil(writeActionLog(env, {
    action: "deleteTask",
    entityType: "task",
    entityId: taskId,
    message: `X\xF3a task: ${deletedLabel}`,
    oldJson: row,
    newJson: null,
    actor
  }));
  return json({ ok: true });
}
__name(deleteTask, "deleteTask");
async function quickUpdateStatus(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const taskId = cleanString(body.taskId || body.task_id, 50);
  const status = body.status;
  if (!taskId) return json({ ok: false, error: "Thi\u1EBFu task_id" }, 400);
  if (!VALID_STATUS2.has(status)) return json({ ok: false, error: "Tr\u1EA1ng th\xE1i kh\xF4ng h\u1EE3p l\u1EC7" }, 400);
  const row = await getTaskSQL(env.DB, taskId);
  if (!row) return json({ ok: false, error: "Kh\xF4ng t\xECm th\u1EA5y task" }, 404);
  const now = nowIso();
  let completedAt = row.completed_at;
  if (status === "hoan_thanh" && !completedAt) completedAt = now;
  if (status !== "hoan_thanh") completedAt = null;
  await quickUpdateTaskStatusSQL(env.DB, taskId, status, completedAt, now);
  await invalidateKv(env, [DASHBOARD_CACHE_KEY]);
  ctx.waitUntil(writeActionLog(env, {
    action: "quickUpdateTaskStatus",
    entityType: "task",
    entityId: taskId,
    message: `\u0110\u1ED5i tr\u1EA1ng th\xE1i task "${row.title}": ${row.status} \u2192 ${status}`,
    oldJson: { status: row.status },
    newJson: { status },
    actor
  }));
  return json({ ok: true });
}
__name(quickUpdateStatus, "quickUpdateStatus");
async function quickUpdatePriority(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const taskId = cleanString(body.taskId || body.task_id, 50);
  const priority = body.priority;
  if (!taskId) return json({ ok: false, error: "Thi\u1EBFu task_id" }, 400);
  if (!VALID_PRIORITY.has(priority)) return json({ ok: false, error: "\u01AFu ti\xEAn kh\xF4ng h\u1EE3p l\u1EC7" }, 400);
  const row = await getTaskSQL(env.DB, taskId);
  if (!row) return json({ ok: false, error: "Kh\xF4ng t\xECm th\u1EA5y task" }, 404);
  const now = nowIso();
  await quickUpdateTaskPrioritySQL(env.DB, taskId, priority, now);
  ctx.waitUntil(writeActionLog(env, {
    action: "quickUpdateTaskPriority",
    entityType: "task",
    entityId: taskId,
    message: `\u0110\u1ED5i \u01B0u ti\xEAn task "${row.title}": ${row.priority} \u2192 ${priority}`,
    oldJson: { priority: row.priority },
    newJson: { priority },
    actor
  }));
  return json({ ok: true });
}
__name(quickUpdatePriority, "quickUpdatePriority");
async function suggestCompanies(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const q = normalizeText(p.q || "");
  const limit = q ? 10 : Math.min(Number(p.limit) || 20, 20);
  const suggestions = await suggestTaskCompaniesSQL(env.DB, q, limit);
  return json({ ok: true, suggestions });
}
__name(suggestCompanies, "suggestCompanies");

// src/worker/handlers/scheduled.js
var DASHBOARD_TTL = 300;
var REPORT_TTL = 21600;
function todayVN2() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1e3);
  return d.toISOString().slice(0, 10);
}
__name(todayVN2, "todayVN");
function dateAddVN(days) {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1e3 + days * 864e5);
  return d.toISOString().slice(0, 10);
}
__name(dateAddVN, "dateAddVN");
async function runScheduledTasks(env, cron) {
  await warmDashboard(env).catch((err) => console.error("[cron] dashboard warmup failed:", err));
  if (cron === "0 2 * * *") {
    await Promise.allSettled([
      scanExpiredQuotes(env),
      scanRfqDeadlines(env),
      scanOrphanMedia(env),
      purgeOldAuditLogs(env)
    ]);
  }
}
__name(runScheduledTasks, "runScheduledTasks");
async function warmDashboard(env) {
  const data = await getDashboardV2SQL(env.DB);
  await setKv(env, "dashboard:v2", data, DASHBOARD_TTL);
  console.log("[cron] dashboard:v2 warmed");
}
__name(warmDashboard, "warmDashboard");
async function scanExpiredQuotes(env) {
  const today = todayVN2();
  const report = await getExpiredQuotesReportSQL(env.DB, today);
  await setKv(env, "quotes:expired:report", {
    count: report.count,
    samples: report.samples,
    generated_at: (/* @__PURE__ */ new Date()).toISOString()
  }, REPORT_TTL);
  console.log(`[cron] quotes:expired:report \u2014 count=${report.count}`);
}
__name(scanExpiredQuotes, "scanExpiredQuotes");
async function scanRfqDeadlines(env) {
  const today = todayVN2();
  const d7 = dateAddVN(7);
  const report = await getRfqDeadlineReportSQL(env.DB, today, d7);
  await setKv(env, "rfq:deadline:scan", {
    overdue_count: report.overdue_count,
    due_soon_count: report.due_soon_count,
    samples: report.samples,
    generated_at: (/* @__PURE__ */ new Date()).toISOString()
  }, REPORT_TTL);
  console.log(`[cron] rfq:deadline:scan \u2014 overdue=${report.overdue_count} due_soon=${report.due_soon_count}`);
}
__name(scanRfqDeadlines, "scanRfqDeadlines");
async function purgeOldAuditLogs(env) {
  const result = await env.DB.prepare(
    `DELETE FROM audit_logs WHERE created_at < datetime('now', '-365 days')`
  ).run();
  console.log(`[cron] audit_logs: purged ${result.meta?.changes ?? 0} rows older than 365 days`);
}
__name(purgeOldAuditLogs, "purgeOldAuditLogs");
async function scanOrphanMedia(env) {
  const report = await getOrphanMediaReportSQL(env.DB);
  await setKv(env, "media:orphan:report", {
    quote_orphan_count: report.quote_orphan_count,
    rfq_item_orphan_count: report.rfq_item_orphan_count,
    samples: report.samples,
    generated_at: (/* @__PURE__ */ new Date()).toISOString()
  }, REPORT_TTL);
  console.log(`[cron] media:orphan:report \u2014 quote=${report.quote_orphan_count} rfq_item=${report.rfq_item_orphan_count}`);
}
__name(scanOrphanMedia, "scanOrphanMedia");

// src/worker/index.js
var ACCOUNT_ACTIONS = ["authLogin", "initSetup", "logout", "getSession", "changePassword", "getAccounts", "createAccount", "updateAccount"];
var CLIENT_ACTIONS = ["getClients", "createClient", "updateClient", "archiveClient"];
var CLIENT_EQUIPMENT_ACTIONS = ["getClientEquipment", "createClientEquipment", "updateClientEquipment", "archiveClientEquipment", "importClientEquipment"];
var CLIENT_CONTACT_ACTIONS = ["getClientContacts", "createClientContact", "updateClientContact", "archiveClientContact", "importClientContacts"];
var CLIENT_BANK_ACCOUNT_ACTIONS = ["getClientBankAccounts", "createClientBankAccount", "updateClientBankAccount", "archiveClientBankAccount"];
var CLIENT_LEGAL_HISTORY_ACTIONS = ["getClientLegalHistory", "addClientLegalHistory"];
var RFQ_CONTACT_ACTIONS = ["getRfqContacts", "addRfqContact", "archiveRfqContact"];
var SUPPLIER_ACTIONS = ["getSuppliers", "createSupplier", "updateSupplier", "archiveSupplier"];
var RFQ_ACTIONS = ["getDashboard", "getRfqs", "getRfq", "createRfq", "updateRfq", "archiveRfq", "quickUpdateRfqStatus"];
var RFQ_ITEM_ACTIONS = ["getRfqItems", "getRfqItem", "createRfqItem", "updateRfqItem", "archiveRfqItem", "hardDeleteRfqItems", "hardDeleteAllRfqItems", "exportRfqItemsCsv", "exportRfqItemsJson"];
var TECHNICAL_CLARIFICATION_ACTIONS = ["getTechnicalClarifications", "getItemRevisions", "createTechnicalClarification", "updateTechnicalClarification", "deleteTechnicalClarification", "quickUpdateClarification"];
var SUPPLIER_QUOTE_ACTIONS = ["getSupplierQuotes", "searchSupplierQuotes", "createSupplierQuote", "updateSupplierQuote", "archiveSupplierQuote", "deleteSupplierQuote"];
var PRICING_DECISION_ACTIONS = ["getPricingDecisions", "createPricingDecision"];
var AUDIT_ACTIONS = ["getAuditLogs"];
var MEDIA_ACTIONS = ["getMediaFiles", "uploadMedia", "getMediaFileContent"];
var IMPORT_ACTIONS = ["getImportTemplates", "saveImportTemplate", "checkRfqImportSafety", "commitImportRows", "previewImportRows", "getImportJob", "getImportJobRows"];
var ITEM_ACTIONS = ["searchMasterItems", "getMasterItemDetail", "suggestMasterItemsForRfqItem", "createMasterItem", "updateMasterItem", "linkRfqItemToMaster", "unlinkRfqItemFromMaster"];
var PRICE_HISTORY_ACTIONS = ["searchPriceHistory", "getPriceHistorySummary", "exportPriceHistoryCsv"];
var CONTRACT_ACTIONS = ["getContracts", "getContractDetail", "getContractItemsForRfqItem", "createContract", "updateContract", "archiveContract", "addContractItem", "updateContractItem", "archiveContractItem", "createContractFromRfqItem"];
var DELIVERY_ACTIONS = ["getDeliveryNotes", "getDeliveryNoteDetail", "getDeliveryItemsForRfqItem", "createDeliveryNote", "updateDeliveryNote", "archiveDeliveryNote", "addDeliveryNoteItem", "updateDeliveryNoteItem", "archiveDeliveryNoteItem", "recordDeliveryAcceptance", "deleteDeliveryNote", "previewDeliveryNoteNo"];
var DASHBOARD_V2_ACTIONS = ["getDashboardV2"];
var OCR_ACTIONS = ["ocrImage"];
var TASK_ACTIONS = ["getTasks", "getTask", "createTask", "updateTask", "deleteTask", "quickUpdateTaskStatus", "quickUpdateTaskPriority", "suggestTaskCompanies"];
var PUBLIC_ACTIONS = ["authLogin", "initSetup"];
var worker_default = {
  async fetch(request, env, ctx) {
    const allowedOrigin = env.ALLOWED_ORIGIN || null;
    if (request.method === "OPTIONS") return cors(json({ ok: true }), allowedOrigin);
    if (!validateSecret(request, env)) return cors(json({ ok: false, error: "Forbidden" }, 403), allowedOrigin);
    const { action, parsedBody } = await getActionAndBody(request);
    if (!action) return cors(json({ ok: false, error: "Missing action" }, 400), allowedOrigin);
    let actor = null;
    if (!PUBLIC_ACTIONS.includes(action)) {
      actor = actorFromRequest(request);
      if (!await validateActorSession(env.DB, actor)) {
        return cors(json({ ok: false, error: "Session het han" }, 401), allowedOrigin);
      }
    }
    let res;
    if (ACCOUNT_ACTIONS.includes(action)) res = await handleAccounts(action, request, env, ctx, actor);
    else if (CLIENT_ACTIONS.includes(action)) res = await handleClients(action, request, env, ctx, actor, parsedBody);
    else if (CLIENT_EQUIPMENT_ACTIONS.includes(action)) res = await handleClientEquipment(action, request, env, ctx, actor);
    else if (CLIENT_CONTACT_ACTIONS.includes(action)) res = await handleClientContacts(action, request, env, ctx, actor);
    else if (CLIENT_BANK_ACCOUNT_ACTIONS.includes(action)) res = await handleClientBankAccounts(action, request, env, ctx, actor);
    else if (CLIENT_LEGAL_HISTORY_ACTIONS.includes(action)) res = await handleClientLegalHistory(action, request, env, ctx, actor);
    else if (RFQ_CONTACT_ACTIONS.includes(action)) res = await handleRfqContacts(action, request, env, ctx, actor);
    else if (SUPPLIER_ACTIONS.includes(action)) res = await handleSuppliers(action, request, env, ctx, actor);
    else if (RFQ_ACTIONS.includes(action)) res = await handleRfqs(action, request, env, ctx, actor);
    else if (RFQ_ITEM_ACTIONS.includes(action)) res = await handleRfqItems(action, request, env, ctx, actor);
    else if (TECHNICAL_CLARIFICATION_ACTIONS.includes(action)) res = await handleTechnicalClarifications(action, request, env, ctx, actor);
    else if (SUPPLIER_QUOTE_ACTIONS.includes(action)) res = await handleSupplierQuotes(action, request, env, ctx, actor);
    else if (PRICING_DECISION_ACTIONS.includes(action)) res = await handlePricingDecisions(action, request, env, ctx, actor);
    else if (AUDIT_ACTIONS.includes(action)) res = await handleAudit(action, request, env, ctx, actor);
    else if (MEDIA_ACTIONS.includes(action)) res = await handleMedia(action, request, env, ctx, actor);
    else if (IMPORT_ACTIONS.includes(action)) res = await handleImports(action, request, env, ctx, actor);
    else if (ITEM_ACTIONS.includes(action)) res = await handleItems(action, request, env, ctx, actor);
    else if (PRICE_HISTORY_ACTIONS.includes(action)) res = await handlePriceHistory(action, request, env, ctx, actor);
    else if (CONTRACT_ACTIONS.includes(action)) res = await handleContracts(action, request, env, ctx, actor);
    else if (DELIVERY_ACTIONS.includes(action)) res = await handleDelivery(action, request, env, ctx, actor);
    else if (DASHBOARD_V2_ACTIONS.includes(action)) res = await handleDashboard(action, request, env, ctx, actor);
    else if (OCR_ACTIONS.includes(action)) res = await handleOcr(action, request, env, ctx, actor);
    else if (TASK_ACTIONS.includes(action)) res = await handleTasks(action, request, env, ctx, actor);
    else res = json({ ok: false, error: "Unknown action" }, 400);
    return cors(res, allowedOrigin);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledTasks(env, event.cron));
  }
};
async function getActionAndBody(request) {
  if (request.method === "GET") {
    return { action: new URL(request.url).searchParams.get("action") || "", parsedBody: null };
  }
  if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
    const cloned = request.clone();
    const action = (await cloned.formData().catch(() => new FormData())).get("action") || "uploadMedia";
    return { action, parsedBody: null };
  }
  const parsedBody = await readJson(request.clone());
  return { action: parsedBody.action || "", parsedBody };
}
__name(getActionAndBody, "getActionAndBody");
function cors(response, allowedOrigin) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", allowedOrigin || "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Worker-Secret,X-App-Actor");
  return new Response(response.body, { status: response.status, headers });
}
__name(cors, "cors");

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-aVXoi6/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-aVXoi6/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
