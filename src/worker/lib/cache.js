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

export async function consumeKvRateLimit(env, key, limit, windowSeconds) {
  const kv = env.KV;
  if (!kv) return { allowed: false, retryAfter: windowSeconds, error: 'KV binding chua cau hinh' };
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const retryAfter = Math.max(1, windowStart + windowSeconds - now);
  const storageKey = `rate:v1:${key}:${windowStart}`;
  try {
    const current = Number(await kv.get(storageKey)) || 0;
    if (current >= limit) return { allowed: false, retryAfter };
    await kv.put(storageKey, String(current + 1), { expirationTtl: windowSeconds + 60 });
    return { allowed: true, retryAfter };
  } catch {
    // Login protection must fail closed when its KV dependency is unavailable.
    return { allowed: false, retryAfter: windowSeconds, error: 'Khong the kiem tra gioi han dang nhap' };
  }
}
