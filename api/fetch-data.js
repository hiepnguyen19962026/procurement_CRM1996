export const config = { runtime: 'edge' };

const COOKIE_NAME = 'procurement_sess';
const JWT_EXPIRES = 7 * 24 * 60 * 60;
const PUBLIC_ACTIONS = new Set(['authLogin', 'initSetup', 'logout']);
const VIEW_ACTIONS = ['ping', 'logout', 'getSession', 'changePassword', 'getDashboard', 'getClients', 'getSuppliers', 'getRfqs', 'getRfqItems', 'getMediaFiles', 'getTechnicalClarifications', 'getSupplierQuotes', 'searchSupplierQuotes', 'getImportTemplates', 'getImportJob', 'getImportJobRows', 'searchMasterItems', 'getMasterItemDetail', 'suggestMasterItemsForRfqItem', 'searchPriceHistory', 'getPriceHistorySummary', 'exportPriceHistoryCsv'];
const PURCHASING_ACTIONS = [...VIEW_ACTIONS, 'createClient', 'updateClient', 'createSupplier', 'updateSupplier', 'createRfq', 'updateRfq', 'createRfqItem', 'updateRfqItem', 'createTechnicalClarification', 'createSupplierQuote', 'updateSupplierQuote', 'getPricingDecisions', 'saveImportTemplate', 'commitImportRows', 'createMasterItem', 'linkRfqItemToMaster', 'unlinkRfqItemFromMaster'];
const MANAGER_ACTIONS = [...PURCHASING_ACTIONS, 'updateTechnicalClarification', 'deleteTechnicalClarification', 'archiveSupplierQuote', 'getAuditLogs', 'createPricingDecision', 'updateMasterItem'];
const ADMIN_ACTIONS = [...MANAGER_ACTIONS, 'getAccounts', 'createAccount', 'updateAccount'];

export default async function handler(request) {
  try {
    const body = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams.entries()) : await request.json().catch(() => ({}));
    const action = body.action || '';
    if (action === 'ping') return json({ ok: true, pong: true });
    if (action === 'logout') return clearSession();
    if (!action) return json({ ok: false, error: 'Missing action' }, 400);

    if (action === 'initSetup') {
      return json(await callWorker(action, body));
    }

    if (action === 'authLogin') {
      const data = await callWorker(action, body);
      if (!data.ok) return json(data, data.status || 401);
      const token = await signJWT(data.user, process.env.JWT_SECRET, JWT_EXPIRES);
      return json(data, 200, { 'set-cookie': sessionCookie(token) });
    }

    const actor = await readSession(request);
    if (!actor) return json({ ok: false, error: 'Chua dang nhap' }, 401);
    if (!isAllowed(actor.role, action)) return json({ ok: false, error: 'Khong co quyen' }, 403);

    const data = await callWorker(action, body, actor);
    return json(data, data.ok === false ? 400 : 200);
  } catch (err) {
    return json({ ok: false, error: err.message || 'Gateway error' }, 500);
  }
}

function isAllowed(role, action) {
  if (role === 'admin') return ADMIN_ACTIONS.includes(action);
  if (role === 'manager') return MANAGER_ACTIONS.includes(action);
  if (role === 'purchasing') return PURCHASING_ACTIONS.includes(action);
  if (role === 'viewer') return VIEW_ACTIONS.includes(action);
  return PUBLIC_ACTIONS.has(action);
}

async function callWorker(action, body, actor) {
  const url = process.env.WORKER_URL;
  if (!url || !process.env.WORKER_SECRET) throw new Error('Missing WORKER_URL or WORKER_SECRET');
  const headers = {
    'content-type': 'application/json',
    'X-Worker-Secret': process.env.WORKER_SECRET,
  };
  if (actor) headers['X-App-Actor'] = encodeActor(actor);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, action }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({ ok: false, error: `Worker HTTP ${res.status}` }));
  return { ...data, status: res.status };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
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
