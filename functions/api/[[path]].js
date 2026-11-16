// Cloudflare Pages Function: teruskan /api/* ke server Node.
// Tidak mengubah logika API. Browser tetap memanggil same-origin /api
// sehingga server.js tidak perlu header CORS.
function resolveOrigin(raw) {
  const s = String(raw || '').trim().replace(/\/$/, '');
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  return u.origin;
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequest(context) {
  const origin = resolveOrigin(context.env && context.env.API_ORIGIN);
  if (!origin) {
    return json(503, { error: 'API_ORIGIN belum diatur. Isi origin publik server Node, tanpa slash akhir.' });
  }
  const incoming = new URL(context.request.url);
  if (origin === incoming.origin) {
    return json(500, { error: 'API_ORIGIN tidak boleh sama dengan origin Pages.' });
  }
  if (!incoming.pathname.startsWith('/api/')) {
    return json(404, { error: 'Not found' });
  }
  const target = origin + incoming.pathname + incoming.search;
  const headers = new Headers(context.request.headers);
  headers.delete('host');
  headers.delete('content-length');
  const method = context.request.method;
  const init = { method, headers, redirect: 'manual' };
  if (method !== 'GET' && method !== 'HEAD') init.body = await context.request.arrayBuffer();
  try {
    return await fetch(target, init);
  } catch {
    return json(502, { error: 'API tidak terjangkau' });
  }
}
