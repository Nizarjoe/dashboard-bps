import { apiError } from './errors.js';
import { handleV1 } from './api-v1.js';

export async function handleApi(request, env, execCtx) {
  try {
    return await handleV1(request, env || {}, execCtx);
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', message: String(e && e.message || e) }));
    return apiError(502, 'UPSTREAM_ERROR', 'Terjadi kesalahan pada server.');
  }
}

export async function dispatch(request, env, execCtx) {
  return handleApi(request, env || {}, execCtx);
}
