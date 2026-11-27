// Akses database aplikasi (binding APPDB, D1). Terpisah dari binding DB lama.
// Bila APPDB tidak terpasang, fitur yang butuh jejak audit membalas 503 FITUR_BELUM_AKTIF.
import { apiError } from './errors.js';

export function appDb(env) {
  const db = env && env.APPDB;
  return db && typeof db.prepare === 'function' ? db : null;
}

export function belumAktif() {
  return apiError(503, 'FITUR_BELUM_AKTIF', 'Fitur ini belum aktif di lingkungan ini (database aplikasi belum terpasang).', { retryable: false });
}

export function waktuSekarang(env) {
  return env && env.NOW != null ? new Date(Number(env.NOW)).toISOString() : new Date().toISOString();
}

export async function catatAudit(db, { waktu, oleh, peran, entitas, entitasId, aksi, data }) {
  await db.prepare('INSERT INTO audit (waktu, oleh, peran, entitas, entitas_id, aksi, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(waktu, oleh, peran, entitas, String(entitasId), aksi, JSON.stringify(data || {})).run();
}

export async function daftarAudit(db, { entitas, entitasId, limit }) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  let sql = 'SELECT id, waktu, oleh, peran, entitas, entitas_id, aksi, data FROM audit';
  const where = [];
  const args = [];
  if (entitas) { args.push(entitas); where.push('entitas = ?' + args.length); }
  if (entitasId) { args.push(entitasId); where.push('entitas_id = ?' + args.length); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT ' + lim;
  const { results } = await db.prepare(sql).bind(...args).all();
  return (results || []).map(r => ({
    id: r.id, waktu: r.waktu, oleh: r.oleh, peran: r.peran, entitas: r.entitas, entitasId: r.entitas_id, aksi: r.aksi,
    data: (() => { try { return JSON.parse(r.data); } catch { return {}; } })(),
  }));
}

// ===== Penanda hapus foto =====

function kunciFoto(jenis, id, slot) {
  return jenis + ':' + id + ':' + slot;
}

// Map "jenis:id:slot" -> waktu penanda aktif terbaru. Kosong bila APPDB tidak ada.
export async function muatPenandaFoto(env, jenis, id) {
  const db = appDb(env);
  const out = new Map();
  if (!db) return out;
  const stmt = jenis
    ? db.prepare('SELECT jenis, sampel_id, slot, MAX(waktu) AS waktu FROM foto_hapus WHERE batal_at IS NULL AND jenis = ?1 AND sampel_id = ?2 GROUP BY jenis, sampel_id, slot').bind(jenis, id)
    : db.prepare('SELECT jenis, sampel_id, slot, MAX(waktu) AS waktu FROM foto_hapus WHERE batal_at IS NULL GROUP BY jenis, sampel_id, slot');
  const { results } = await stmt.all();
  for (const r of results || []) out.set(kunciFoto(r.jenis, r.sampel_id, r.slot), r.waktu);
  return out;
}

function waktuMs(v) {
  const t = Date.parse(String(v || ''));
  return Number.isNaN(t) ? 0 : t;
}

// Buang unggahan yang tertutup penanda hapus.
export function saringFoto(uploads, penanda, jenis, id) {
  if (!penanda || !penanda.size) return uploads || [];
  return (uploads || []).filter(f => {
    const w = penanda.get(kunciFoto(jenis, id, f.slot));
    return !w || waktuMs(f.waktu) > waktuMs(w);
  });
}

export async function tandaiFotoHapus(db, { jenis, id, slot, waktu, oleh, alasan }) {
  await db.prepare('INSERT INTO foto_hapus (jenis, sampel_id, slot, waktu, oleh, alasan) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(jenis, id, slot, waktu, oleh, alasan || '').run();
}

export async function pulihkanFoto(db, { jenis, id, slot, waktu, oleh }) {
  const r = await db.prepare('UPDATE foto_hapus SET batal_at = ?1, batal_oleh = ?2 WHERE jenis = ?3 AND sampel_id = ?4 AND slot = ?5 AND batal_at IS NULL')
    .bind(waktu, oleh, jenis, id, slot).run();
  return Number(r && r.meta && r.meta.changes || 0);
}
