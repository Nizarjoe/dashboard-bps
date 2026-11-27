// Endpoint monitoring v2. Akses (K5): admin penuh, PML disamarkan server, mitra 403.
import { apiError, apiOk } from './errors.js';
import { BIDANG, bacaParamArsip, cariTab, daftarTab, itemPublik, katalogMeta } from './katalog.js';
import { bacaCache, deteksiHeader, masihSegar, muatTab, responGalat } from './gsheet.js';
import { samarkanRows } from './samaran.js';
import { hitungRingkasan } from './ringkasan.js';

// Batas ambil Google per permintaan batch. Satu ambil bisa 2 subrequest
// (redirect 307 ke googleusercontent), jadi 10 x 2 = 20 dari jatah 50.
export const BATAS_AMBIL_BATCH = 10;

function tolakMitra(user) {
  if (user.role === 'admin' || user.role === 'pml') return null;
  return apiError(403, 'FORBIDDEN', 'Monitoring hanya untuk admin dan PML.', { retryable: false });
}

function bacaBidang(url) {
  const b = url.searchParams.get('bidang') || '';
  if (b && !BIDANG.includes(b)) return { error: apiError(400, 'VALIDATION', 'Parameter bidang harus tp, inpek, atau horti.', { fields: { bidang: 'tidak dikenal' }, retryable: false }) };
  return { bidang: b || null };
}

function tabDariUrl(url) {
  const id = url.searchParams.get('id');
  if (id) return cariTab({ id });
  const sid = url.searchParams.get('sid');
  if (sid) return cariTab({ sid, gid: url.searchParams.get('gid') || '0' });
  return undefined;
}

export function katalog(url, user) {
  const tolak = tolakMitra(user);
  if (tolak) return tolak;
  const b = bacaBidang(url);
  if (b.error) return b.error;
  const arsip = bacaParamArsip(url);
  const data = daftarTab({ bidang: b.bidang, arsip }).map(itemPublik);
  return apiOk({
    data,
    meta: {
      total: data.length,
      tersedia: data.filter(d => d.tersedia).length,
      arsipDitampilkan: arsip,
      ...katalogMeta(),
    },
  });
}

// Kompat /api/gsheets: { sheets: [...] } dengan field lama + field v2.
export function katalogLama(url, user) {
  const tolak = tolakMitra(user);
  if (tolak) return tolak;
  const arsip = bacaParamArsip(url);
  return apiOk({ sheets: daftarTab({ arsip }).map(itemPublik), meta: { arsipDitampilkan: arsip } });
}

export async function tab(url, env, user) {
  const tolak = tolakMitra(user);
  if (tolak) return tolak;
  const t = tabDariUrl(url);
  if (t === undefined) return apiError(400, 'VALIDATION', 'Sertakan id atau sid dan gid.', { fields: { id: 'wajib' }, retryable: false });
  if (!t) return responGalat('NOT_FOUND');
  if (t.tersedia === false) return responGalat(t.alasan.kode, t, t.alasan.pesan);
  const r = await muatTab(env, t);
  if (!r.ok) return responGalat(r.code, t);
  const headerRow = deteksiHeader(r.rows, t.headerRow);
  const meta = { syncedAt: r.syncedAt, changedAt: r.changedAt, stale: r.stale, disamarkan: false };
  if (r.error) meta.error = r.error;
  let rows = r.rows;
  if (user.role !== 'admin') {
    const s = samarkanRows(r.rows, headerRow, t.samaran);
    rows = s.rows;
    meta.disamarkan = true;
    meta.kolomDisamarkan = s.kolomDisamarkan;
    meta.selDisamarkanPola = s.selPindai;
  }
  const pub = itemPublik(t);
  return apiOk({
    id: t.id,
    label: t.label,
    bidang: t.bidang,
    survei: t.survei,
    tahun: t.tahun,
    arsip: pub.arsip,
    tautan: pub.tautan,
    headerRow,
    header: headerRow ? rows[headerRow - 1] : [],
    rows,
    meta,
  });
}

function ringkasSatu(t, r) {
  const headerRow = deteksiHeader(r.rows, t.headerRow);
  const h = hitungRingkasan(t.ringkasan, r.rows, headerRow);
  const meta = { syncedAt: r.syncedAt, changedAt: r.changedAt, stale: r.stale, headerRow };
  if (r.error) meta.error = r.error;
  if (!h.ok) return { ok: false, code: h.code, kolom: h.kolom, meta };
  const { ok, ...isi } = h;
  return { ok: true, isi, meta };
}

export async function ringkasan(url, env, user) {
  const tolak = tolakMitra(user);
  if (tolak) return tolak;
  const t = tabDariUrl(url);
  if (t !== undefined) {
    if (!t) return responGalat('NOT_FOUND');
    if (!t.ringkasan) return apiError(422, 'RINGKASAN_BELUM_DIPETAKAN', t.bidang === 'tp' ? 'Tab ini belum punya pemetaan kolom ringkasan (arsip atau belum dipetakan).' : 'Ringkasan progres baru tersedia untuk Tanaman Pangan.', { retryable: false, sumber: { id: t.id, label: t.label } });
    if (t.tersedia === false) return responGalat(t.alasan.kode, t, t.alasan.pesan);
    const r = await muatTab(env, t);
    if (!r.ok) return responGalat(r.code, t);
    const s = ringkasSatu(t, r);
    if (!s.ok) return apiError(422, s.code, 'Kolom yang dipetakan tidak ditemukan di sheet: ' + s.kolom.join(', ') + '.', { fields: { kolom: s.kolom }, retryable: false, sumber: { id: t.id, label: t.label } });
    return apiOk({ id: t.id, label: t.label, survei: t.survei, ...s.isi, meta: s.meta });
  }
  const b = bacaBidang(url);
  if (b.error) return b.error;
  const bidang = b.bidang || 'tp';
  if (bidang !== 'tp') return apiError(422, 'RINGKASAN_BELUM_DIPETAKAN', 'Ringkasan progres baru tersedia untuk Tanaman Pangan.', { retryable: false });
  const arsip = bacaParamArsip(url);
  const semua = daftarTab({ bidang, arsip });
  const dipetakan = semua.filter(x => x.ringkasan && x.tersedia !== false);
  // Fase 1: cache saja (tanpa Google). Fase 2: ambil Google maksimal BATAS_AMBIL_BATCH.
  const cache = await Promise.all(dipetakan.map(x => bacaCache(env, x)));
  let jatah = BATAS_AMBIL_BATCH;
  const izin = cache.map(c => {
    if (masihSegar(env, c)) return true;
    if (jatah > 0) { jatah--; return true; }
    return false;
  });
  const hasil = await Promise.all(dipetakan.map((x, i) => muatTab(env, x, { cache: cache[i], bolehAmbil: izin[i] })));
  let diambil = 0;
  const data = dipetakan.map((x, i) => {
    const r = hasil[i];
    const dasar = { id: x.id, label: x.label, survei: x.survei };
    if (!r.ok) {
      if (r.code === 'BATAS_PERMINTAAN') return { ...dasar, status: 'ditunda', error: { code: r.code, message: 'Ditunda karena batas ambil per permintaan. Muat ulang sebentar lagi.' } };
      return { ...dasar, status: 'galat', error: { code: r.code, message: 'Sumber tab ini tidak bisa dibaca.' } };
    }
    if (r.sumberData === 'google') diambil++;
    const s = ringkasSatu(x, r);
    if (!s.ok) return { ...dasar, status: 'galat', error: { code: s.code, message: 'Kolom hilang: ' + s.kolom.join(', ') }, meta: s.meta };
    return { ...dasar, status: 'ok', ...s.isi, meta: s.meta };
  });
  const tanpa = semua.filter(x => !x.ringkasan || x.tersedia === false).map(x => ({
    id: x.id,
    label: x.label,
    alasan: x.tersedia === false ? x.alasan.kode : (x.arsip ? 'ARSIP_BELUM_DIPETAKAN' : 'BELUM_DIPETAKAN'),
  }));
  return apiOk({
    bidang,
    data,
    tanpaRingkasan: tanpa,
    meta: {
      total: data.length,
      ok: data.filter(d => d.status === 'ok').length,
      ditunda: data.filter(d => d.status === 'ditunda').length,
      galat: data.filter(d => d.status === 'galat').length,
      diambilDariGoogle: diambil,
      batasAmbil: BATAS_AMBIL_BATCH,
      arsipDitampilkan: arsip,
    },
  });
}
