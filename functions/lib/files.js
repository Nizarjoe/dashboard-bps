import { json } from './http.js';

const MAX = 5 * 1024 * 1024;
const KV_MAX = 200 * 1024;
const R2_MISSING = 'Penyimpanan berkas (R2 binding UPLOADS) belum terpasang. Bucket R2 membutuhkan metode pembayaran di akun Cloudflare. Berkas kecil dapat disimpan di KV bila ukurannya di bawah 200 KB.';

export function sniff(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return { ext: 'jpg', mime: 'image/jpeg' };
  const head = new TextDecoder().decode(bytes.subarray(0, 12));
  if (head.startsWith('RIFF') && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (head.startsWith('GIF')) return { ext: 'gif', mime: 'image/gif' };
  const s = new TextDecoder().decode(bytes.subarray(0, Math.min(300, bytes.length))).trim();
  if (s.startsWith('<svg') || s.startsWith('<?xml')) return { ext: 'svg', mime: 'image/svg+xml' };
  return null;
}

function hex(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function safeKey(raw) {
  const key = String(raw || '');
  if (!/^[a-zA-Z0-9._-]{1,180}$/.test(key)) return null;
  return key;
}

async function putBlob(env, key, bytes, mime) {
  if (env.UPLOADS && typeof env.UPLOADS.put === 'function') {
    await env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: mime } });
    return 'r2';
  }
  if (bytes.byteLength > KV_MAX) {
    const err = new Error(R2_MISSING);
    err.status = 503;
    throw err;
  }
  await env.SESSIONS.put('up:' + key, bytes);
  return 'kv';
}

async function getBlob(env, key, backend) {
  if (backend === 'r2') {
    if (!env.UPLOADS) return null;
    const obj = await env.UPLOADS.get(key);
    if (!obj) return null;
    return obj.body;
  }
  const buf = await env.SESSIONS.get('up:' + key, { type: 'arrayBuffer' });
  if (!buf) return null;
  return buf;
}

export async function upload(request, env, me) {
  const len = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(len) && len > MAX) return json(400, { ok: false, error: 'Maksimal 5 MB' });
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > MAX) return json(400, { ok: false, error: 'Maksimal 5 MB' });
  const kind = sniff(buf);
  if (!kind) return json(400, { ok: false, error: 'Hanya gambar PNG, JPG, WEBP, GIF, atau SVG' });
  const key = 'berkas_' + String(me.kode).replace(/[^a-z0-9]/gi, '') + '_' + Date.now() + '_' + hex(3) + '.' + kind.ext;
  let backend;
  try {
    backend = await putBlob(env, key, buf, kind.mime);
  } catch (e) {
    if (e && e.status === 503) return json(503, { ok: false, error: e.message });
    throw e;
  }
  await env.DB.prepare(
    'INSERT INTO upload (key, mime, size, kode, backend, dibuat) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  ).bind(key, kind.mime, buf.byteLength, me.kode, backend, Date.now()).run();
  return json(200, { ok: true, file: key, url: '/api/file/' + key, backend });
}

export async function download(env, rawKey) {
  const key = safeKey(rawKey);
  if (!key) return json(404, { error: 'Not found' });
  const meta = await env.DB.prepare(
    'SELECT key, mime, size, kode, backend FROM upload WHERE key = ?1'
  ).bind(key).first();
  if (!meta) return json(404, { error: 'Berkas tidak ditemukan' });
  const body = await getBlob(env, key, meta.backend);
  if (!body) return json(404, { error: 'Berkas tidak ditemukan' });
  const headers = {
    'content-type': meta.mime || 'application/octet-stream',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  };
  if (String(meta.mime).includes('svg')) headers['content-disposition'] = 'attachment; filename="' + key + '"';
  return new Response(body, { status: 200, headers });
}

export async function removeFile(env, me, rawKey) {
  const key = safeKey(rawKey);
  if (!key) return json(404, { error: 'Not found' });
  const meta = await env.DB.prepare('SELECT key, kode, backend FROM upload WHERE key = ?1').bind(key).first();
  if (!meta) return json(404, { error: 'Berkas tidak ditemukan' });
  if (me.role === 'kab' && meta.kode !== me.kode) return json(403, { error: 'Bukan berkas Anda' });
  if (meta.backend === 'r2' && env.UPLOADS) await env.UPLOADS.delete(key);
  else await env.SESSIONS.delete('up:' + key);
  await env.DB.prepare('DELETE FROM upload WHERE key = ?1').bind(key).run();
  return json(200, { ok: true });
}
