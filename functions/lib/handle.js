import { CONSTANTS } from './constants.js';
import { json, bearer } from './http.js';
import { proxyRequest } from './proxy.js';
import { login, logout, me } from './auth.js';
import { getSession } from './session.js';
import { routeAuthed } from './routes.js';

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  try {
    if (path === '/api/login' && method === 'POST') return await login(request, env);
    if (path === '/api/logout' && (method === 'POST' || method === 'DELETE')) return await logout(request, env);
    if (path === '/api/me' && method === 'GET') return await me(request, env);
    if (path === '/api/constants' && method === 'GET') return json(200, CONSTANTS);
    if (!path.startsWith('/api/')) return json(404, { error: 'Not found' });
    const session = await getSession(env.SESSIONS, bearer(request));
    if (!session) return json(401, { error: 'Belum login' });
    return await routeAuthed(request, env, session, path, method, url);
  } catch (e) {
    const message = String(e && e.message || e);
    if (/no such table/i.test(message)) {
      return json(503, { error: 'Tabel D1 belum ada. Terapkan migrasi di folder migrations/.' });
    }
    console.error(JSON.stringify({ level: 'error', path, method, message }));
    return json(500, { error: message });
  }
}

export async function dispatch(request, env) {
  if (env && env.SESSIONS) return handleApi(request, env);
  return proxyRequest(request, env || {});
}
