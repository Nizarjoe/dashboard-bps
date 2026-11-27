// Cadangan: teruskan /api/* ke server Node bila binding SESSIONS tidak ada.
import { json } from './http.js';

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

export async function proxyRequest(request, env) {
  const origin = resolveOrigin(env && env.API_ORIGIN);
  if (!origin) {
    return json(503, { error: 'API_ORIGIN belum diatur. Isi origin publik server Node, tanpa slash akhir.' });
  }
  const incoming = new URL(request.url);
  if (origin === incoming.origin) {
    return json(500, { error: 'API_ORIGIN tidak boleh sama dengan origin Pages.' });
  }
  if (!incoming.pathname.startsWith('/api/')) {
    return json(404, { error: 'Not found' });
  }
  const target = origin + incoming.pathname + incoming.search;
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  const method = request.method;
  const init = { method, headers, redirect: 'manual' };
  if (method !== 'GET' && method !== 'HEAD') init.body = await request.arrayBuffer();
  try {
    return await fetch(target, init);
  } catch {
    return json(502, { error: 'API tidak terjangkau' });
  }
}
