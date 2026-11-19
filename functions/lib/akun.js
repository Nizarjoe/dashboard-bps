import { apiError } from './errors.js';
import { canonNama, loadSumber } from './sumber.js';
import { createStore } from './store.js';

const ADMIN = { id: '3305', nama: 'Admin Kebumen', peran: 'admin', role: 'admin', pml_id: '', aktif: true };

function nextNumber(rows, prefix, width) {
  let max = 0;
  for (const row of rows) {
    if (!String(row.id || '').startsWith(prefix)) continue;
    const n = Number(String(row.id).slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1).padStart(width, '0');
}

function padId(prefix, n, width) {
  return prefix + String(n).padStart(width, '0');
}

export function namaDariSheet(records) {
  const mitra = new Set();
  const pml = new Set();
  const pairs = new Map();
  for (const rec of records) {
    if (rec.pcl) mitra.add(rec.pcl);
    if (rec.pml) pml.add(rec.pml);
    if (rec.pcl && rec.pml) {
      const set = pairs.get(rec.pcl) || new Set();
      set.add(rec.pml);
      pairs.set(rec.pcl, set);
    }
  }
  return { mitra: [...mitra].sort((a, b) => a.localeCompare(b, 'id')), pml: [...pml].sort((a, b) => a.localeCompare(b, 'id')), pairs };
}

export async function ensureAkun(store, records) {
  const existing = await store.listAkun();
  const { mitra, pml, pairs } = namaDariSheet(records);
  const mitraRows = existing.filter(a => (a.peran || a.role) === 'mitra');
  const pmlRows = existing.filter(a => (a.peran || a.role) === 'pml');
  const haveM = new Set(mitraRows.map(a => canonNama(a.nama)));
  const haveP = new Set(pmlRows.map(a => canonNama(a.nama)));
  const fresh = existing.length === 0;
  let mSeq = fresh ? 1 : Number(nextNumber(mitraRows, '3305', 3));
  let pSeq = fresh ? 1 : Number(nextNumber(pmlRows, '3305P', 2));
  if (!fresh && mitraRows.length === 0) mSeq = 1;
  if (!fresh && pmlRows.length === 0) pSeq = 1;
  const created = [];
  const sumberM = fresh ? mitra : mitra.filter(n => !haveM.has(n));
  const sumberP = fresh ? pml : pml.filter(n => !haveP.has(n));
  for (const nama of sumberM) {
    const id = padId('3305', mSeq, 3);
    mSeq += 1;
    created.push({ id, nama, peran: 'mitra', role: 'mitra', pml_id: '', aktif: true });
  }
  for (const nama of sumberP) {
    const id = padId('3305P', pSeq, 2);
    pSeq += 1;
    created.push({ id, nama, peran: 'pml', role: 'pml', pml_id: '', aktif: true });
  }
  for (const row of created) await store.upsertAkun(row);
  let all = await store.listAkun();
  const pmlByName = new Map(all.filter(a => (a.peran || a.role) === 'pml').map(a => [canonNama(a.nama), a]));
  for (const row of all.filter(a => (a.peran || a.role) === 'mitra')) {
    const set = pairs.get(canonNama(row.nama)) || new Set();
    const ids = [...set].map(n => pmlByName.get(n)).filter(Boolean).map(a => a.id);
    const pml_id = ids.join(',');
    if (pml_id !== (row.pml_id || '')) await store.upsertAkun({ ...row, pml_id, peran: 'mitra', role: 'mitra', aktif: row.aktif !== false });
  }
  if (!all.some(a => a.id === '3305')) await store.upsertAkun(ADMIN);
  all = await store.listAkun();
  return all.map(normalizeAkun);
}

const AKUN_FRESH = 'akun:fresh';
const AKUN_LAST = 'akun:last';
const AKUN_TTL = 300;
const AKUN_LAST_TTL = 7 * 24 * 60 * 60;

function parseAkunCache(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.akun)) return null;
    return { list: data.akun, syncedAt: data.syncedAt || null };
  } catch {
    return null;
  }
}

export function deferWork(execCtx, fn) {
  const job = Promise.resolve().then(fn).catch(e => {
    console.error(JSON.stringify({ level: 'error', message: String(e && e.message || e) }));
  });
  if (execCtx && typeof execCtx.waitUntil === 'function') execCtx.waitUntil(job);
  return job;
}

export async function syncAkun(env, store, records) {
  let recs = records;
  if (!recs) {
    const sumber = await loadSumber(env);
    if (sumber.error) {
      const err = new Error('sumber');
      err.response = sumber.error;
      throw err;
    }
    recs = sumber.records;
  }
  const list = await ensureAkun(store || createStore(env), recs);
  const kv = env && env.SESSIONS;
  if (kv) {
    const packed = JSON.stringify({ akun: list, syncedAt: new Date().toISOString() });
    await kv.put(AKUN_LAST, packed, { expirationTtl: AKUN_LAST_TTL });
    await kv.put(AKUN_FRESH, packed, { expirationTtl: AKUN_TTL });
  }
  return list;
}

export async function readAkunCache(env) {
  const kv = env && env.SESSIONS;
  if (!kv) return null;
  const fresh = parseAkunCache(await kv.get(AKUN_FRESH));
  if (fresh) return { list: fresh.list, fresh: true, syncedAt: fresh.syncedAt };
  const last = parseAkunCache(await kv.get(AKUN_LAST));
  if (last) return { list: last.list, fresh: false, syncedAt: last.syncedAt };
  return null;
}

export async function resolveAkun(env, store, records, execCtx) {
  const cached = await readAkunCache(env);
  if (cached && cached.fresh) return { list: cached.list, fresh: true, syncedAt: cached.syncedAt };
  if (cached) {
    deferWork(execCtx, () => syncAkun(env, store, records));
    return { list: cached.list, fresh: false, syncedAt: cached.syncedAt };
  }
  try {
    const list = await syncAkun(env, store, records);
    return { list, fresh: true, syncedAt: new Date().toISOString() };
  } catch (e) {
    if (e && e.response) return { error: e.response };
    if (e && e.code === 'UPSTREAM_ERROR') {
      return { error: apiError(502, 'UPSTREAM_ERROR', 'Penyimpanan isian gagal dihubungi.') };
    }
    throw e;
  }
}

export function normalizeAkun(row) {
  const role = row.role || row.peran;
  return {
    id: String(row.id),
    nama: canonNama(row.nama),
    role,
    peran: role,
    pml_id: row.pml_id || '',
    aktif: row.aktif !== false && row.aktif !== '0' && row.aktif !== 'tidak',
  };
}
