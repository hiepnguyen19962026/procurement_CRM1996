export const config = { runtime: 'edge' };

const COOKIE_NAME = 'procurement_sess';
const UPLOAD_ROLES = new Set(['admin', 'manager', 'purchasing']);

export default async function handler(request) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  const actor = await readSession(request);
  if (!actor || !UPLOAD_ROLES.has(actor.role)) return json({ ok: false, error: 'Khong co quyen upload' }, 403);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 8 * 1024 * 1024) return json({ ok: false, error: 'File toi da 8MB trong Phase 1' }, 400);
  if (!process.env.WORKER_URL || !process.env.WORKER_SECRET) return json({ ok: false, error: 'Missing Worker env' }, 500);

  const headers = new Headers(request.headers);
  headers.set('X-Worker-Secret', process.env.WORKER_SECRET);
  headers.set('X-App-Actor', encodeActor(actor));
  headers.delete('host');

  const res = await fetch(process.env.WORKER_URL, {
    method: 'POST',
    headers,
    body: request.body,
    signal: AbortSignal.timeout(30000),
  });
  return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'application/json' } });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function encodeActor(actor) {
  const bytes = new TextEncoder().encode(JSON.stringify(actor));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function readSession(request) {
  const cookie = request.headers.get('cookie') || '';
  const token = cookie.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${COOKIE_NAME}=`))?.split('=')[1];
  if (!token || !process.env.JWT_SECRET) return null;
  return verifyJWT(token, process.env.JWT_SECRET);
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
