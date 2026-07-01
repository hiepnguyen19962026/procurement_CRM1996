export const config = { runtime: 'edge' };

const COOKIE_NAME = 'procurement_sess';
const JWT_EXPIRES = 7 * 24 * 60 * 60;
const UPLOAD_ROLES = new Set(['purchasing', 'manager', 'admin']);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export default async function handler(request) {
  try {
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405);
    }

    const actor = await readSession(request);
    if (!actor) return json({ ok: false, error: 'Chua dang nhap' }, 401);
    if (!UPLOAD_ROLES.has(actor.role)) {
      await logPermissionDenied(actor, 'uploadMedia').catch(() => null);
      return json({ ok: false, error: 'Khong co quyen' }, 403);
    }

    const contentLength = request.headers.get('content-length');
    if (!contentLength) return json({ ok: false, error: 'Missing Content-Length' }, 411);
    const size = Number(contentLength);
    if (!Number.isFinite(size) || size <= 0) return json({ ok: false, error: 'Invalid Content-Length' }, 400);
    if (size > MAX_UPLOAD_BYTES) return json({ ok: false, error: 'File toi da 10MB' }, 413);

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return json({ ok: false, error: 'Content-Type phai la multipart/form-data' }, 400);
    }

    const url = process.env.WORKER_URL;
    if (!url || !process.env.WORKER_SECRET) throw new Error('Missing WORKER_URL or WORKER_SECRET');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        'X-Worker-Secret': process.env.WORKER_SECRET,
        'X-App-Actor': encodeActor(actor),
      },
      body: request.body,
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({ ok: false, error: `Worker HTTP ${res.status}` }));
    return json(safeGatewayBody(data, res.status), res.status, retryAfterHeaders(res));
  } catch {
    return json({ ok: false, error: 'Lỗi hệ thống. Vui lòng thử lại sau.', status: 500 }, 500);
  }
}

async function logPermissionDenied(actor, deniedAction) {
  const url = process.env.WORKER_URL;
  if (!url || !process.env.WORKER_SECRET) return;
  await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Worker-Secret': process.env.WORKER_SECRET,
      'X-App-Actor': encodeActor(actor),
    },
    body: JSON.stringify({ action: 'logPermissionDenied', deniedAction }),
    signal: AbortSignal.timeout(5000),
  });
}

function safeGatewayBody(data, status) {
  if (status >= 500) {
    return { ok: false, error: 'Lỗi hệ thống. Vui lòng thử lại sau.', status };
  }
  return data;
}

function retryAfterHeaders(response) {
  const retryAfter = response.headers.get('retry-after');
  return retryAfter ? { 'retry-after': retryAfter } : {};
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
