import { getLastEntityIdSQL, nextEntitySequenceSQL } from '../db/system-queries.js';

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export async function readJson(request) {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    return Object.fromEntries(url.searchParams.entries());
  }
  return request.json().catch(() => ({}));
}

export function nowIso() {
  return new Date().toISOString();
}

export function publicActorName(actor) {
  return actor?.displayName || actor?.username || actor?.id || 'System';
}

export function clampLimit(value, fallback = 50, max = 200) {
  const n = Number(value || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

export async function nextEntityId(db, table, idCol, prefix) {
  const year = new Date().getUTCFullYear();
  const key = `${prefix}-${year}`;
  const seedRow = await getLastEntityIdSQL(db, table, idCol, `${prefix}-${year}-%`);
  const seed = seedRow?.id ? Number(String(seedRow.id).split('-').pop()) : 0;
  const row = await nextEntitySequenceSQL(db, key, Number.isFinite(seed) ? seed : 0);
  return `${prefix}-${year}-${String(Number(row?.last_value || 1)).padStart(5, '0')}`;
}

export function makeId(prefix) {
  const rand = crypto.randomUUID().slice(0, 8).toUpperCase();
  return `${prefix}-${new Date().getUTCFullYear()}-${rand}`;
}

export function compactObject(obj = {}, keys = []) {
  const out = {};
  keys.forEach((key) => {
    if (obj[key] !== undefined) out[key] = obj[key];
  });
  return out;
}
