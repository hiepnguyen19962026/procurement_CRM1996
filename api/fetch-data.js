export const config = { runtime: 'edge' };

const COOKIE_NAME = 'procurement_sess';
const JWT_EXPIRES = 7 * 24 * 60 * 60;
const PUBLIC_ACTIONS = new Set(['authLogin', 'initSetup', 'logout']);
const VIEW_ACTIONS = ['ping', 'logout', 'getSession', 'changePassword', 'getDashboard', 'getClients', 'getSuppliers', 'getRfqs', 'getRfq', 'getRfqItems', 'getRfqItem', 'getMediaFiles', 'listAllClarifications', 'getTechnicalClarifications', 'getItemRevisions', 'getSupplierQuotes', 'searchSupplierQuotes', 'getImportTemplates', 'getImportJob', 'getImportJobRows', 'searchMasterItems', 'getMasterItemDetail', 'suggestMasterItemsForRfqItem', 'searchPriceHistory', 'getPriceHistorySummary', 'getContracts', 'getContractDetail', 'getContractItemsForRfqItem', 'getContractAddendums', 'getContractAddendumItems', 'searchContractAddendumItems', 'getDeliveryNotes', 'getDeliveryNoteDetail', 'getDeliveryItemsForRfqItem', 'getDashboardV2', 'getClientEquipment', 'getClientContacts', 'getClientBankAccounts', 'getClientLegalHistory', 'getRfqContacts', 'getTasks', 'getTask', 'suggestTaskCompanies', 'previewDeliveryNoteNo'];
const SMALL_EXPORT_ACTIONS = ['exportRfqItemsCsv', 'exportRfqItemsJson', 'exportPriceHistoryCsv'];
const VIEWER_ACTIONS = [...VIEW_ACTIONS, ...SMALL_EXPORT_ACTIONS];
const PURCHASING_ACTIONS = [...VIEWER_ACTIONS, 'createClient', 'updateClient', 'createSupplier', 'updateSupplier', 'createRfq', 'updateRfq', 'quickUpdateRfqStatus', 'createRfqItem', 'updateRfqItem', 'createTechnicalClarification', 'quickUpdateClarification', 'createSupplierQuote', 'updateSupplierQuote', 'getPricingDecisions', 'saveImportTemplate', 'checkRfqImportSafety', 'commitImportRows', 'previewImportRows', 'createMasterItem', 'linkRfqItemToMaster', 'unlinkRfqItemFromMaster', 'createContract', 'updateContract', 'addContractItem', 'updateContractItem', 'createContractFromRfqItem', 'createContractAddendum', 'updateContractAddendum', 'createContractAddendumItem', 'updateContractAddendumItem', 'createDeliveryNote', 'updateDeliveryNote', 'addDeliveryNoteItem', 'updateDeliveryNoteItem', 'recordDeliveryAcceptance', 'createClientEquipment', 'updateClientEquipment', 'archiveClientEquipment', 'importClientEquipment', 'createClientContact', 'updateClientContact', 'archiveClientContact', 'importClientContacts', 'createClientBankAccount', 'updateClientBankAccount', 'archiveClientBankAccount', 'addClientLegalHistory', 'addRfqContact', 'archiveRfqContact', 'createTask', 'updateTask', 'quickUpdateTaskStatus', 'quickUpdateTaskPriority'];
const MANAGER_ACTIONS = [...PURCHASING_ACTIONS, 'updateTechnicalClarification', 'deleteTechnicalClarification', 'archiveSupplierQuote', 'deleteSupplierQuote', 'createPricingDecision', 'updateMasterItem', 'archiveContract', 'archiveContractItem', 'archiveContractAddendum', 'archiveContractAddendumItem', 'archiveDeliveryNote', 'archiveDeliveryNoteItem', 'archiveRfq', 'archiveRfqItem', 'archiveClient', 'archiveSupplier', 'hardDeleteRfqItems', 'hardDeleteAllRfqItems', 'deleteTask'];
const ADMIN_ACTIONS = [...MANAGER_ACTIONS, 'getAuditLogs', 'getAccounts', 'createAccount', 'updateAccount', 'deleteDeliveryNote'];

export default async function handler(request) {
  try {
    if (!['GET', 'POST'].includes(request.method)) {
      return json({ ok: false, error: 'Method not allowed' }, 405, { allow: 'GET, POST' });
    }
    const body = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams.entries()) : await request.json().catch(() => ({}));
    const action = body.action || '';
    if (action === 'ping') return json({ ok: true, pong: true });
    if (!action) return json({ ok: false, error: 'Missing action' }, 400);

    if (action === 'initSetup') {
      const data = await callWorker(action, body);
      const status = data.status || (data.ok === false ? 400 : 200);
      return json(safeGatewayBody(data, status), status, retryAfterHeaders(data));
    }

    if (action === 'authLogin') {
      const loginIpHash = await hashIdentifier(clientIp(request), process.env.JWT_SECRET || process.env.WORKER_SECRET);
      const data = await callWorker(action, body, null, { 'X-Login-IP-Hash': loginIpHash });
      if (!data.ok) {
        const status = data.status || 401;
        return json(safeGatewayBody(data, status), status, retryAfterHeaders(data));
      }
      const token = await signJWT(data.user, process.env.JWT_SECRET, JWT_EXPIRES);
      return json(data, 200, { 'set-cookie': sessionCookie(token) });
    }

    const actor = await readSession(request);
    if (action === 'logout') {
      if (actor) await callWorker(action, body, actor).catch(() => null);
      return clearSession();
    }
    if (!actor) return json({ ok: false, error: 'Chua dang nhap' }, 401);
    if (!isAllowed(actor.role, action)) {
      await callWorker('logPermissionDenied', { deniedAction: action }, actor).catch(() => null);
      return json({ ok: false, error: 'Khong co quyen' }, 403);
    }
    if (isExportAction(action) && !canBypassExportLimit(actor.role) && requestedExportLimit(body) > 1000) {
      await callWorker('logPermissionDenied', { deniedAction: action }, actor).catch(() => null);
      return json({ ok: false, error: 'Chi Admin hoac Manager moi duoc xuat tai tep du lieu tren 1000 dong' }, 403);
    }

    const data = await callWorker(action, body, actor);
    const status = data.status || (data.ok === false ? 400 : 200);
    return json(safeGatewayBody(data, status), status, retryAfterHeaders(data));
  } catch {
    return json({ ok: false, error: 'Lỗi hệ thống. Vui lòng thử lại sau.', status: 500 }, 500);
  }
}

function isAllowed(role, action) {
  if (role === 'admin') return ADMIN_ACTIONS.includes(action);
  if (role === 'manager') return MANAGER_ACTIONS.includes(action);
  if (role === 'purchasing') return PURCHASING_ACTIONS.includes(action);
  if (role === 'viewer') return VIEWER_ACTIONS.includes(action);
  return PUBLIC_ACTIONS.has(action);
}

async function callWorker(action, body, actor, extraHeaders = {}) {
  const url = process.env.WORKER_URL;
  if (!url || !process.env.WORKER_SECRET) throw new Error('Missing WORKER_URL or WORKER_SECRET');
  const headers = {
    'content-type': 'application/json',
    'X-Worker-Secret': process.env.WORKER_SECRET,
    ...extraHeaders,
  };
  if (actor) headers['X-App-Actor'] = encodeActor(actor);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, action }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({ ok: false, error: `Worker HTTP ${res.status}` }));
  return { ...data, status: res.status, retryAfter: res.headers.get('retry-after') || data.retryAfter };
}

function isExportAction(action) {
  return SMALL_EXPORT_ACTIONS.includes(action);
}

function canBypassExportLimit(role) {
  return role === 'admin' || role === 'manager';
}

function requestedExportLimit(body) {
  const selected = Array.isArray(body?.selectedIds) ? body.selectedIds.length : 0;
  if (selected > 0) return selected;
  const limit = Number(body?.limit || body?.requestedRows || body?.requested_rows || 0);
  return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

function retryAfterHeaders(data) {
  return data?.retryAfter ? { 'retry-after': String(data.retryAfter) } : {};
}

function safeGatewayBody(data, status) {
  if (status >= 500 && String(data?.error || '').startsWith('Migration required:')) {
    return data;
  }
  if (status >= 500) {
    return { ok: false, error: 'Lỗi hệ thống. Vui lòng thử lại sau.', status };
  }
  return data;
}

function clientIp(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
}

async function hashIdentifier(value, secret) {
  if (!secret) throw new Error('Missing secret for login rate limit');
  const bytes = new TextEncoder().encode(`${secret}:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function clearSession() {
  return json({ ok: true }, 200, {
    'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
  });
}

function sessionCookie(token) {
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${JWT_EXPIRES}`,
  ].join('; ');
}

async function readSession(request) {
  const cookie = request.headers.get('cookie') || '';
  const token = cookie.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${COOKIE_NAME}=`))?.split('=')[1];
  if (!token || !process.env.JWT_SECRET) return null;
  return verifyJWT(token, process.env.JWT_SECRET);
}

function encodeActor(actor) {
  const bytes = new TextEncoder().encode(JSON.stringify(actor));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function signJWT(payload, secret, expiresSec) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ ...payload, iat: now, exp: now + expiresSec }));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

async function verifyJWT(token, secret) {
  const [header, claims, sig] = token.split('.');
  if (!header || !claims || !sig) return null;
  const expected = await signRaw(`${header}.${claims}`, secret);
  if (expected !== sig) return null;
  const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(claims.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(claims.length / 4) * 4, '=')), (c) => c.charCodeAt(0))));
  if (!json.exp || json.exp < Math.floor(Date.now() / 1000)) return null;
  return json;
}

async function signRaw(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return b64url(sig);
}
