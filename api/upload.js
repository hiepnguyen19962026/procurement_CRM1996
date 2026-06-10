export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }
  return json({
    ok: false,
    error: 'Upload is disabled in Phase 1 until MIME allowlist and magic-byte validation are implemented.',
  }, 501);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
