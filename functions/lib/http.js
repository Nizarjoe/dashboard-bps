export function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(len) && len > 1_000_000) return {};
  let text = '';
  try { text = await request.text(); } catch { return {}; }
  if (text.length > 1_000_000) return {};
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

export function bearer(request) {
  return (request.headers.get('authorization') || '').replace('Bearer ', '');
}
