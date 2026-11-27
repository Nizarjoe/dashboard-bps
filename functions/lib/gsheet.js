// Pembaca Google Sheet publik untuk monitoring v2 (K1: baca langsung, tanpa salin ke D1).
//
// Cache dua lapis:
//   1. Map di memori isolate (TTL MON_TTL_S, default 300 detik).
//   2. KV `mon:v2:<sid>:<gid>` = { hash, rows, checkedAt, changedAt, savedAt }.
// KV hanya ditulis bila isi sheet BERUBAH (hash SHA-256 beda) dan tulisan terakhir
// untuk tab itu lebih tua dari MON_KV_MIN_WRITE_S (default 7200 detik). Tidak ada
// tulisan "heartbeat"; data yang lebih baru tetap disajikan dari memori.
import { apiError, apiOk } from './errors.js';
import { cariTab, itemPublik, semuaTab } from './katalog.js';

const TTL_DEFAULT = 300;
const MIN_WRITE_DEFAULT = 7200;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 8_000_000;
const KV_PREFIX = 'mon:v2:';
const PENANDA_KOSONG = new Set(['', '-', '#n/a', '#ref!', '#value!', '#div/0!', '#name?', '#error!', '()']);

export const GALAT = {
  NOT_FOUND: { status: 404, retryable: false, pesan: 'Tab tidak terdaftar di katalog monitoring.' },
  SHEET_FORMAT_UNSUPPORTED: { status: 422, retryable: false, pesan: 'Format file sumber tidak didukung (bukan Google Sheets asli).' },
  SHEET_REMOVED: { status: 410, retryable: false, pesan: 'File atau tab sumber sudah dihapus.' },
  SHEET_NOT_PUBLIC: { status: 403, retryable: false, pesan: 'Sheet sumber tidak dibagikan publik, perlu izin pemilik.' },
  SHEET_EXPORT_REJECTED: { status: 502, retryable: false, pesan: 'Google menolak ekspor CSV tab ini.' },
  SHEET_TOO_LARGE: { status: 502, retryable: false, pesan: 'Isi tab terlalu besar untuk dibaca (batas 8 MB).' },
  SOURCE_UNAVAILABLE: { status: 503, retryable: true, pesan: 'Sumber Google Sheet tidak tersedia. Coba lagi nanti.' },
  BATAS_PERMINTAAN: { status: 429, retryable: true, pesan: 'Batas ambil data per permintaan tercapai. Tab ini ditunda.' },
};

export function terisi(v) {
  return !PENANDA_KOSONG.has(String(v ?? '').trim().toLowerCase());
}

export function parseCsv(csv) {
  const rows = [];
  let row = [];
  let cell = '';
  let inq = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inq) {
      if (ch === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inq = false;
      else cell += ch;
    } else if (ch === '"') inq = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') continue;
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const data = rows.filter(r => r.some(v => String(v).trim() !== ''));
  if (!data.length) return [];
  let lastCol = 0;
  data.forEach(r => r.forEach((v, ci) => { if (String(v).trim() !== '') lastCol = Math.max(lastCol, ci); }));
  return data.map(r => r.slice(0, lastCol + 1));
}

// B6: baris header (1-based). Katalog menang; selain itu baris pertama (dari 10)
// yang jumlah sel terisinya >= max(3, 70% dari baris terpadat).
export function deteksiHeader(rows, headerRow) {
  if (!rows.length) return 0;
  if (Number.isInteger(headerRow) && headerRow >= 1 && headerRow <= rows.length) return headerRow;
  const cek = rows.slice(0, 10).map(r => r.filter(v => String(v).trim() !== '').length);
  const maks = Math.max(...cek);
  const ambang = Math.max(Math.min(3, maks), Math.ceil(maks * 0.7));
  const i = cek.findIndex(n => n >= ambang);
  return i < 0 ? 1 : i + 1;
}

function angka(env, name, dflt) {
  const v = Number(env && env[name]);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}

const memoriPerKv = new WeakMap();
const memoriTanpaKv = new Map();
function memori(env) {
  const kv = env && env.SESSIONS;
  if (!kv || typeof kv !== 'object') return memoriTanpaKv;
  let m = memoriPerKv.get(kv);
  if (!m) { m = new Map(); memoriPerKv.set(kv, m); }
  return m;
}

// Untuk uji: kosongkan cache memori isolate milik env ini.
export function lupakanCache(env) {
  memori(env).clear();
}

function kunciTab(tab) {
  return tab.sid + ':' + String(tab.gid);
}

async function hashRows(rows) {
  const data = new TextEncoder().encode(JSON.stringify(rows));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Baca cache tanpa menyentuh Google.
export async function bacaCache(env, tab) {
  const key = kunciTab(tab);
  const mem = memori(env);
  if (mem.has(key)) return mem.get(key);
  const kv = env && env.SESSIONS;
  if (!kv) return null;
  let raw = null;
  try { raw = await kv.get(KV_PREFIX + key); } catch { raw = null; }
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    if (!Array.isArray(rec.rows)) return null;
    mem.set(key, rec);
    return rec;
  } catch {
    return null;
  }
}

export function masihSegar(env, rec, now = Date.now()) {
  if (!rec || !rec.checkedAt) return false;
  return now - Date.parse(rec.checkedAt) < angka(env, 'MON_TTL_S', TTL_DEFAULT) * 1000;
}

function galat(code, detail) {
  return { ok: false, code, detail: detail || null };
}

async function ambilRemote(env, tab) {
  const key = kunciTab(tab);
  if (env && env.GSHEET_FORCE_FAIL) return galat('SOURCE_UNAVAILABLE', 'dipaksa gagal (uji)');
  const inline = env && env.GSHEET_CSV && env.GSHEET_CSV[key];
  if (typeof inline === 'string') return { ok: true, csv: inline };
  const url = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(tab.sid) + '/export?format=csv&gid=' + encodeURIComponent(String(tab.gid));
  const doFetch = (env && typeof env.GSHEET_FETCH === 'function') ? env.GSHEET_FETCH : fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let resp;
  try {
    resp = await doFetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (dashboard-bps monitoring)' } });
  } catch (e) {
    clearTimeout(timer);
    return galat('SOURCE_UNAVAILABLE', e && e.name === 'AbortError' ? 'batas waktu' : 'jaringan');
  }
  try {
    const finalUrl = String(resp.url || '');
    if (/accounts\.google\.com|ServiceLogin/i.test(finalUrl) || resp.status === 401 || resp.status === 403) return galat('SHEET_NOT_PUBLIC', 'HTTP ' + resp.status);
    if (resp.status === 404 || resp.status === 410) return galat('SHEET_REMOVED', 'HTTP ' + resp.status);
    if (resp.status === 400) return galat('SHEET_EXPORT_REJECTED', 'HTTP 400');
    if (!resp.ok) return galat('SOURCE_UNAVAILABLE', 'HTTP ' + resp.status);
    const ct = String(resp.headers.get('content-type') || '');
    const len = Number(resp.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return galat('SHEET_TOO_LARGE');
    const csv = await resp.text();
    if (csv.length > MAX_BYTES) return galat('SHEET_TOO_LARGE');
    if (/text\/html/i.test(ct) || /^\s*<!doctype html|^\s*<html/i.test(csv)) return galat('SHEET_NOT_PUBLIC', 'balasan HTML');
    return { ok: true, csv };
  } catch {
    return galat('SOURCE_UNAVAILABLE', 'baca isi gagal');
  } finally {
    clearTimeout(timer);
  }
}

async function simpan(env, tab, lama, rows) {
  const key = kunciTab(tab);
  const now = new Date();
  const iso = now.toISOString();
  const hash = await hashRows(rows);
  const sama = lama && lama.hash === hash;
  const rec = {
    hash,
    rows,
    checkedAt: iso,
    changedAt: sama ? (lama.changedAt || iso) : iso,
    savedAt: lama ? (lama.savedAt || null) : null,
  };
  const kv = env && env.SESSIONS;
  const jedaMs = angka(env, 'MON_KV_MIN_WRITE_S', MIN_WRITE_DEFAULT) * 1000;
  const bolehTulis = !lama || !lama.savedAt || (now.getTime() - Date.parse(lama.savedAt)) >= jedaMs;
  let ditulis = false;
  if (kv && !sama && bolehTulis) {
    rec.savedAt = iso;
    try {
      await kv.put(KV_PREFIX + key, JSON.stringify(rec));
      ditulis = true;
    } catch {
      rec.savedAt = lama ? (lama.savedAt || null) : null;
    }
  }
  memori(env).set(key, rec);
  return { rec, ditulis };
}

function hasil(rec, stale, error, sumberData) {
  return { ok: true, rows: rec.rows, syncedAt: rec.checkedAt, changedAt: rec.changedAt || null, stale, error: error || null, sumberData };
}

// Muat satu tab dari katalog. Tidak memanggil Google untuk tab tersedia:false.
// opts.bolehAmbil=false: jangan ambil dari Google (dipakai batas subrequest batch).
export async function muatTab(env, tab, opts = {}) {
  if (!tab) return galat('NOT_FOUND');
  if (tab.tersedia === false) return galat(tab.alasan && tab.alasan.kode || 'SHEET_FORMAT_UNSUPPORTED', 'dilewati katalog');
  const lama = opts.cache !== undefined ? opts.cache : await bacaCache(env, tab);
  if (masihSegar(env, lama)) return hasil(lama, false, null, 'cache');
  if (opts.bolehAmbil === false) {
    if (lama) return hasil(lama, true, { code: 'BATAS_PERMINTAAN', message: GALAT.BATAS_PERMINTAAN.pesan }, 'cache');
    return galat('BATAS_PERMINTAAN');
  }
  const r = await ambilRemote(env, tab);
  if (!r.ok) {
    if (lama) return hasil(lama, true, { code: r.code, message: GALAT[r.code].pesan }, 'cache');
    return r;
  }
  const rows = parseCsv(r.csv);
  const { rec, ditulis } = await simpan(env, tab, lama, rows);
  const out = hasil(rec, false, null, 'google');
  out.kvDitulis = ditulis;
  return out;
}

export function responGalat(code, tab, pesan) {
  const g = GALAT[code] || GALAT.SOURCE_UNAVAILABLE;
  const extra = { retryable: g.retryable };
  if (tab) extra.sumber = { id: tab.id, label: tab.label };
  if (code === 'SOURCE_UNAVAILABLE' || code === 'BATAS_PERMINTAAN') extra.retryAfter = 60;
  return apiError(g.status, code, pesan || g.pesan, extra);
}

// ===== Kompatibilitas lama (routes.js dan frontend ca22f02) =====

export function sheetCatalog(opts = {}) {
  return semuaTab().filter(s => opts.arsip === true || !s.arsip).map(itemPublik);
}

export function allowedPair(sid, gid) {
  return Boolean(cariTab({ sid, gid: String(gid || '0') }));
}

export async function readAllowedSheet(env, sid, gid) {
  const tab = cariTab({ sid, gid: String(gid || '0') });
  if (!tab) return responGalat('NOT_FOUND');
  if (tab.tersedia === false) return responGalat(tab.alasan.kode, tab, tab.alasan.pesan);
  const r = await muatTab(env, tab);
  if (!r.ok) return responGalat(r.code, tab);
  const headerRow = deteksiHeader(r.rows, tab.headerRow);
  return apiOk({ rows: r.rows, headerRow, header: headerRow ? r.rows[headerRow - 1] : [], meta: { syncedAt: r.syncedAt, stale: r.stale } });
}
