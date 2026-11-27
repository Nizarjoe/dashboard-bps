const enc = new TextEncoder();

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export function canonical(timestamp, nonce, payload) {
  return String(timestamp) + '.' + String(nonce) + '.' + stableStringify(payload);
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function signBody(secret, op, payload, now) {
  const timestamp = String(now == null ? Math.floor(Date.now() / 1000) : now);
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = [...nonceBytes].map(b => b.toString(16).padStart(2, '0')).join('');
  const signature = await hmacHex(secret, canonical(timestamp, nonce, payload));
  return { op, timestamp, nonce, payload, signature };
}

export async function verifySigned(body, secret, seen, nowSec) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'badan tidak valid' };
  const timestamp = String(body.timestamp || '');
  const nonce = String(body.nonce || '');
  const payload = body.payload;
  const signature = String(body.signature || '');
  if (!/^\d+$/.test(timestamp) || !/^[0-9a-f]{16,}$/i.test(nonce) || !signature) {
    return { ok: false, error: 'tanda tangan tidak lengkap' };
  }
  const skew = Math.abs((nowSec == null ? Math.floor(Date.now() / 1000) : nowSec) - Number(timestamp));
  if (skew > 300) return { ok: false, error: 'tanda tangan kedaluwarsa' };
  const expect = await hmacHex(secret, canonical(timestamp, nonce, payload));
  if (expect.length !== signature.length) return { ok: false, error: 'tanda tangan salah' };
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff !== 0) return { ok: false, error: 'tanda tangan salah' };
  if (seen && seen.has(nonce)) return { ok: false, error: 'nonce sudah dipakai' };
  if (seen) seen.add(nonce);
  return { ok: true };
}
