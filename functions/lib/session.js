// Sesi Bearer di KV. TTL 7 hari, diperpanjang bila sisa umur kurang dari 1 hari.
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PREFIX = 'sess:';
const RENEW_AFTER_MS = 6 * 24 * 60 * 60 * 1000;

export function newToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function key(token) {
  return PREFIX + token;
}

export function sessionKey(token) {
  return key(token);
}

export async function putSession(kv, token, user) {
  const id = String(user.id || user.kode || '');
  const payload = {
    id,
    nama: user.nama,
    role: user.role,
    iat: Date.now(),
  };
  await kv.put(key(token), JSON.stringify(payload), { expirationTtl: SESSION_TTL_SECONDS });
}

export async function getSession(kv, token) {
  if (!/^[0-9a-f]{48}$/.test(token || '')) return null;
  const raw = await kv.get(key(token));
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch { return null; }
  const id = s && (s.id || s.kode);
  if (!id || typeof s.role !== 'string') return null;
  return {
    id: String(id),
    nama: typeof s.nama === 'string' ? s.nama : String(id),
    role: s.role,
    iat: typeof s.iat === 'number' ? s.iat : 0,
  };
}

export async function deleteSession(kv, token) {
  if (!/^[0-9a-f]{48}$/.test(token || '')) return;
  await kv.delete(key(token));
}

export async function touchSession(kv, token, session) {
  if (session.iat && Date.now() - session.iat < RENEW_AFTER_MS) return;
  await putSession(kv, token, session);
}
