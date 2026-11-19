import { json } from './http.js';
import { getSheet, postSheet } from './sheets.js';
import { realisasi, kpi, ksaRekap, monitoringGc } from './stats.js';
import { readAllowedSheet, sheetCatalog } from './gsheet.js';
import { apiOk, apiError } from './errors.js';
import { listUsers, createUser } from './users.js';
import { upload, download, removeFile } from './files.js';

function needDb(env) {
  if (env.DB && typeof env.DB.prepare === 'function') return null;
  return json(503, { error: 'Basis data D1 (binding DB) belum terpasang.' });
}

export async function routeAuthed(request, env, me, path, method, url) {
  if (path === '/api/gsheets' && method === 'GET') {
    if (!me || me.role !== 'admin') return apiError(403, 'FORBIDDEN', 'Hanya admin yang dapat membuka monitoring.');
    return apiOk({ sheets: sheetCatalog() });
  }
  if (path === '/api/gsheet' && method === 'GET') {
    if (!me || me.role !== 'admin') return apiError(403, 'FORBIDDEN', 'Hanya admin yang dapat membuka monitoring.');
    return readAllowedSheet(env, url.searchParams.get('sid') || '', url.searchParams.get('gid') || '0');
  }

  const dbErr = needDb(env);
  if (dbErr) return dbErr;

  if (path === '/api/realisasi' && method === 'GET') return realisasi(url, env, me);
  if (path === '/api/kpi' && method === 'GET') return kpi(env);
  if (path === '/api/ksa-rekap' && method === 'GET') return ksaRekap(url, env, me);
  if (path === '/api/monitoring-gc' && method === 'GET') return monitoringGc(url, env, me);
  if (path === '/api/users' && method === 'GET') return listUsers(env, me);
  if (path === '/api/users' && method === 'POST') return createUser(request, env, me);
  if (path === '/api/upload' && method === 'POST') return upload(request, env, me);

  const sheet = path.match(/^\/api\/sheet\/([^/]+)$/);
  if (sheet && method === 'GET') return getSheet(request, env, me, sheet[1]);
  if (sheet && method === 'POST') return postSheet(request, env, me, sheet[1]);

  const file = path.match(/^\/api\/file\/([^/]+)$/);
  if (file && method === 'GET') return download(env, me, file[1]);
  if (file && method === 'DELETE') return removeFile(env, me, file[1]);

  return json(404, { error: 'Not found' });
}
