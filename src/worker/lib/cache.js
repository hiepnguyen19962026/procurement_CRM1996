const DEFAULT_TTL = 60 * 60 * 6;

export async function getKv(env, key) {
  try {
    const raw = await env.KV?.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setKv(env, key, value, ttl = DEFAULT_TTL) {
  try {
    await env.KV?.put(key, JSON.stringify(value), { expirationTtl: ttl });
    return true;
  } catch {
    return false;
  }
}

export async function invalidateKv(env, keys = []) {
  await Promise.all(
    [keys].flat().filter(Boolean).map((key) => env.KV?.delete(key).catch(() => null))
  );
}
