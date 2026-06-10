import { getDashboardV2SQL } from '../db/dashboard-queries.js';
import { ALL_ROLES, requireRole } from '../lib/auth.js';
import { getKv, setKv } from '../lib/cache.js';
import { json } from '../lib/utils.js';

const CACHE_KEY = 'dashboard:v2';
const CACHE_TTL = 300;

export async function handleDashboard(action, request, env, ctx, actor) {
  if (action === 'getDashboardV2') return getDashboardV2(env, actor);
  return json({ ok: false, error: 'Unknown dashboard action' }, 400);
}

async function getDashboardV2(env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const cached = await getKv(env, CACHE_KEY);
  if (cached) return json({ ok: true, data: cached });
  const data = await getDashboardV2SQL(env.DB);
  await setKv(env, CACHE_KEY, data, CACHE_TTL);
  return json({ ok: true, data });
}
