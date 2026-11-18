import { CONSTANTS } from './constants.js';
import { json } from './http.js';
import { proxyRequest } from './proxy.js';
import { login, logout, me } from './auth.js';

const UNPORTED = new Set([
  'GET /api/realisasi',
  'GET /api/kpi',
  'GET /api/gsheets',
  'GET /api/gsheet',
  'GET /api/ksa-rekap',
  'GET /api/monitoring-gc',
  'GET /api/users',
  'POST /api/users',
]);

function isUnported(method, path) {
  if (UNPORTED.has(method + ' ' + path)) return true;
  if ((method === 'GET' || method === 'POST') && /^\/api\/sheet\/[^/]+$/.test(path)) return true;
  return false;
}

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
    if (isUnported(method, path)) {
      return json(501, { error: 'Endpoint ini belum dipindahkan ke Cloudflare Pages.' });
    }
    return json(404, { error: 'Not found' });
  } catch (e) {
    console.error(JSON.stringify({
      level: 'error',
      path,
      method,
      message: String(e && e.message || e),
    }));
    return json(500, { error: String(e && e.message || e) });
  }
}

export async function dispatch(request, env) {
  if (env && env.SESSIONS) return handleApi(request, env);
  return proxyRequest(request, env || {});
}
