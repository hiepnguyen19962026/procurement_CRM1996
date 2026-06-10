import { json } from './utils.js';
import { getActorSessionSQL } from '../db/system-queries.js';

export const ROLES = ['admin', 'manager', 'purchasing', 'viewer'];
export const ALL_ROLES = new Set(ROLES);
export const WRITE_ROLES = new Set(['admin', 'manager', 'purchasing']);
export const MANAGE_ROLES = new Set(['admin', 'manager']);
export const ADMIN_ROLES = new Set(['admin']);
const enc = new TextEncoder();

export function validateSecret(request, env) {
  const expected = env?.WORKER_SECRET;
  if (!expected) return false;
  const fromHeader = request.headers.get('X-Worker-Secret');
  const fromBearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return fromHeader === expected || fromBearer === expected;
}

export function actorFromRequest(request) {
  const raw = request.headers.get('X-App-Actor');
  if (!raw) return null;
  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export async function validateActorSession(db, actor) {
  if (!actor?.id || !actor?.sessionVersion) return false;
  const row = await getActorSessionSQL(db, actor.id);
  return Boolean(
    row &&
    row.status === 'active' &&
    row.role === actor.role &&
    Number(row.session_version) === Number(actor.sessionVersion)
  );
}

export function requireRole(actor, allowed) {
  if (!actor?.role || !allowed.has(actor.role)) {
    return json({ ok: false, error: 'Khong co quyen' }, 403);
  }
  return null;
}

export function safeUser(row) {
  if (!row) return null;
  return {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    sessionVersion: row.session_version,
  };
}

function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromB64(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key,
    256
  );
  return `pbkdf2_sha256$100000$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('pbkdf2_sha256$')) return false;
  const [, iter, saltB64, hashB64] = stored.split('$');
  const salt = fromB64(saltB64);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: Number(iter) || 100000 },
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
