import { json, readJson } from './http.js';

export async function listUsers(env, me) {
  if (me.role !== 'superadmin') return json(404, { error: 'Not found' });
  const { results } = await env.DB.prepare('SELECT kode, nama, role FROM users ORDER BY kode').all();
  return json(200, { users: results.map(r => ({ kode: r.kode, nama: r.nama, role: r.role })) });
}

export async function createUser(request, env, me) {
  if (me.role !== 'superadmin') return json(404, { error: 'Not found' });
  const body = await readJson(request);
  const kode = String(body.kode || '').trim();
  if (!kode) return json(400, { error: 'Kode tidak valid / sudah ada' });
  const exists = await env.DB.prepare('SELECT kode FROM users WHERE kode = ?1').bind(kode).first();
  if (exists) return json(400, { error: 'Kode tidak valid / sudah ada' });
  const nama = body.nama || kode;
  const role = body.role || 'kab';
  await env.DB.prepare('INSERT INTO users (kode, password, nama, role) VALUES (?1, ?2, ?3, ?4)')
    .bind(kode, kode, String(nama), String(role)).run();
  return json(200, { ok: true });
}
