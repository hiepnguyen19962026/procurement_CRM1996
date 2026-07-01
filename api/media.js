export const config = { runtime: 'edge' };

const COOKIE_NAME = 'procurement_sess';
const ACCESS_ROLES = new Set(['viewer', 'purchasing', 'manager', 'admin']);

export default async function handler(request) {
  try {
    if (request.method !== 'GET') {
      return json({ ok: false, error: 'Method not allowed' }, 405);
    }

    const actor = await readSession(request);
    if (!actor) return json({ ok: false, error: 'Chua dang nhap' }, 401);
    if (!ACCESS_ROLES.has(actor.role)) return json({ ok: false, error: 'Khong co quyen' }, 403);

    const params = new URL(request.url).searchParams;
    const fileId = params.get('fileId') || '';
    const ownerType = params.get('ownerType') || params.get('owner_type') || '';
    const ownerId = params.get('ownerId') || params.get('owner_id') || '';
    if (!fileId || !ownerType || !ownerId) return json({ ok: false, error: 'Thieu ownerType, ownerId hoac fileId' }, 400);

    const url = process.env.WORKER_URL;
    if (!url || !process.env.WORKER_SECRET) throw new Error('Missing WORKER_URL or WORKER_SECRET');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Worker-Secret': process.env.WORKER_SECRET,
        'X-App-Actor': encodeActor(actor),
      },
      body: JSON.stringify({ action: 'getMediaFileContent', fileId, ownerType, ownerId }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ ok: false, error: `Worker HTTP ${res.status}` }));
      return json(safeGatewayBody(data, res.status), res.status, retryAfterHeaders(res));
    }

    const headers = new Headers();
    copyHeader(res.headers, headers, 'content-type');
    copyHeader(res.headers, headers, 'content-disposition');
    headers.set('cache-control', 'private, no-store');
    headers.set('x-content-type-options', 'nosniff');
    return new Response(res.body, { status: res.status, headers });
  } catch {
    return json({ ok: false, error: 'Lỗi hệ thống. Vui lòng thử lại sau.', status: 500 }, 500);
  }
}

function copyHeader(from, to, name) {
  const value = from.get(name);
  if (value) to.set(name, value);
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
