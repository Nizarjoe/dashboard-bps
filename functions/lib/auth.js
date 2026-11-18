import { USERS } from './users-seed.js';
import { json, readJson, bearer } from './http.js';
import { newToken, putSession, getSession, deleteSession, touchSession } from './session.js';

const BAD_LOGIN = 'Username atau password salah. Hubungi Admin BPS Provinsi Jawa Tengah jika lupa.';

function publicUser(user) {
  return { kode: user.kode, nama: user.nama, role: user.role };
}

export async function lookupUser(env, kode) {
  if (env.DB && typeof env.DB.prepare === 'function') {
    try {
      const row = await env.DB.prepare(
        'SELECT kode, nama, role, password FROM users WHERE kode = ?1'
      ).bind(kode).first();
      if (!row) return null;
      return {
        kode: String(row.kode),
        nama: String(row.nama || row.kode),
        role: String(row.role || 'kab'),
        password: row.password == null ? kode : String(row.password),
      };
    } catch (e) {
      const msg = String(e && e.message || e);
      if (!/no such table/i.test(msg)) throw e;
    }
  }
  const seed = USERS[kode];
  if (!seed) return null;
  return { kode, nama: seed.nama, role: seed.role, password: kode };
}

export async function login(request, env) {
  const body = await readJson(request);
  const username = String(body.username || '').trim();
  const password = String(body.password || '').trim();
  const user = await lookupUser(env, username);
  if (!user || user.password !== password) return json(401, { ok: false, error: BAD_LOGIN });
  const token = newToken();
  const pub = { kode: username, nama: user.nama, role: user.role };
  await putSession(env.SESSIONS, token, pub);
  return json(200, { ok: true, token, user: pub });
}

export async function logout(request, env) {
  const token = bearer(request);
  const session = await getSession(env.SESSIONS, token);
  if (!session) return json(401, { error: 'Belum login' });
  await deleteSession(env.SESSIONS, token);
  return json(200, { ok: true });
}

export async function me(request, env) {
  const token = bearer(request);
  const session = await getSession(env.SESSIONS, token);
  if (!session) return json(401, { error: 'Belum login' });
  await touchSession(env.SESSIONS, token, session);
  return json(200, { user: publicUser(session) });
}
