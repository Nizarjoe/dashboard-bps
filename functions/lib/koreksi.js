// Koreksi PML -> mitra bimbingan. Disimpan di APPDB (D1 terpisah), bukan di sheet.
//
// Status:
//   terkirim   -> PML membuat / mengubah / membuka lagi
//   dibaca     -> mitra menandai dibaca
//   ditanggapi -> mitra membalas (belum diperbaiki / bertanya / keberatan)
//   diperbaiki -> mitra menyatakan sudah diperbaiki
//   ditutup    -> PML (atau admin) menerima dan menutup          [final, bisa dibuka lagi oleh PML]
//   dibatalkan -> PML membatalkan sebelum ada tanggapan          [final]
// PML boleh ubah/batal hanya saat status terkirim atau dibaca (belum ditanggapi).
// Visibilitas: mitra hanya koreksi untuk dirinya, PML hanya koreksi yang ia kirim,
// admin semua. Selain itu 404 (keberadaan koreksi tidak dibocorkan).
import { apiError, apiOk } from './errors.js';
import { readJson } from './http.js';
import { appDb, belumAktif, waktuSekarang } from './appdb.js';
import { cariTab } from './katalog.js';

export const STATUS = ['terkirim', 'dibaca', 'ditanggapi', 'diperbaiki', 'ditutup', 'dibatalkan'];
const FINAL = new Set(['ditutup', 'dibatalkan']);
const BOLEH_UBAH_PML = new Set(['terkirim', 'dibaca']);
const MAKS_CATATAN = 1000;

function idBaru() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return 'K' + [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function teks(v, maks) {
  return String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, maks + 1);
}

function salahValidasi(fields) {
  return apiError(422, 'VALIDATION', 'Data koreksi tidak valid.', { fields, retryable: false });
}

function tidakAda() {
  return apiError(404, 'NOT_FOUND', 'Koreksi tidak ditemukan.', { retryable: false });
}

function bentuk(row, akun) {
  const nama = id => {
    const a = (akun || []).find(x => x.id === id);
    return { id, nama: a ? a.nama : '' };
  };
  const out = {
    id: row.id,
    tipe: row.tipe,
    rujukan: row.tipe === 'sampel'
      ? { jenis: row.jenis, id: row.sampel_id }
      : { tabId: row.tab_id, baris: row.baris },
    bagian: row.bagian,
    catatan: row.catatan,
    status: row.status,
    tanggapan: row.tanggapan,
    mitra: nama(row.mitra_id),
    pml: nama(row.pml_id),
    versi: Number(row.versi),
    dibuat: row.dibuat,
    diubah: row.diubah,
    dibacaAt: row.dibaca_at || null,
    ditanggapiAt: row.ditanggapi_at || null,
    ditutupAt: row.ditutup_at || null,
  };
  if (row.tipe === 'monitoring') {
    const tab = cariTab({ id: row.tab_id });
    out.rujukan.label = tab ? tab.label : '';
  }
  if (Number(row.dihapus)) {
    out.dihapus = true;
    out.dihapusAt = row.dihapus_at;
  }
  return out;
}

async function ambil(db, id) {
  return db.prepare('SELECT * FROM koreksi WHERE id = ?1').bind(id).first();
}

// Baris boleh dilihat user? Koreksi terhapus hanya untuk admin.
function bolehLihat(user, row) {
  if (!row) return false;
  if (user.role === 'admin') return true;
  if (Number(row.dihapus)) return false;
  if (user.role === 'mitra') return row.mitra_id === user.id;
  if (user.role === 'pml') return row.pml_id === user.id;
  return false;
}

async function log(db, { id, waktu, user, aksi, dari, ke, catatan }) {
  return db.prepare('INSERT INTO koreksi_log (koreksi_id, waktu, oleh, peran, aksi, dari_status, ke_status, catatan) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
    .bind(id, waktu, user.id, user.role, aksi, dari || null, ke || null, catatan || '');
}

// Perbarui dengan kunci versi (optimistic). Kembalikan baris baru atau respons galat.
async function perbarui(db, row, user, { set, aksi, ke, catatanLog, versiKlien }) {
  if (versiKlien != null && Number(versiKlien) !== Number(row.versi)) {
    return { error: apiError(409, 'CONFLICT', 'Koreksi sudah berubah. Muat ulang lalu coba lagi.', { retryable: false }) };
  }
  const waktu = waktuSekarang(user.__env);
  const kolom = Object.keys(set);
  const nilai = kolom.map(k => (typeof set[k] === 'function' ? set[k](waktu) : set[k]));
  const sql = 'UPDATE koreksi SET ' + kolom.map((k, i) => k + ' = ?' + (i + 1)).join(', ')
    + ', versi = versi + 1, diubah = ?' + (kolom.length + 1)
    + ' WHERE id = ?' + (kolom.length + 2) + ' AND versi = ?' + (kolom.length + 3);
  const upd = db.prepare(sql).bind(...nilai, waktu, row.id, Number(row.versi));
  // Log hanya masuk bila UPDATE di atas benar-benar terjadi (versi naik tepat 1 dengan waktu ini).
  const lg = db.prepare('INSERT INTO koreksi_log (koreksi_id, waktu, oleh, peran, aksi, dari_status, ke_status, catatan) '
    + 'SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE EXISTS (SELECT 1 FROM koreksi WHERE id = ?1 AND versi = ?9 AND diubah = ?2)')
    .bind(row.id, waktu, user.id, user.role, aksi, row.status, ke || row.status, catatanLog || '', Number(row.versi) + 1);
  const [r] = await db.batch([upd, lg]);
  if (!r || !r.meta || Number(r.meta.changes) !== 1) {
    return { error: apiError(409, 'CONFLICT', 'Koreksi sudah berubah. Muat ulang lalu coba lagi.', { retryable: false }) };
  }
  return { row: await ambil(db, row.id) };
}

function ditolakStatus(row, pesan) {
  return apiError(409, 'STATUS_TIDAK_SESUAI', pesan + ' (status sekarang: ' + row.status + ').', { retryable: false, fields: { status: row.status } });
}

// ===== Handler =====

export async function daftar(url, ctx, user) {
  const db = appDb(ctx.env);
  if (!db) return belumAktif();
  const where = [];
  const args = [];
  const tambah = (sql, v) => { args.push(v); where.push(sql.replace('?', '?' + args.length)); };
  if (user.role === 'mitra') tambah('mitra_id = ?', user.id);
  else if (user.role === 'pml') tambah('pml_id = ?', user.id);
  else if (user.role !== 'admin') return apiError(403, 'FORBIDDEN', 'Tidak berhak.');
  const termasukHapus = user.role === 'admin' && url.searchParams.get('termasukDihapus') === '1';
  if (!termasukHapus) where.push('dihapus = 0');
  const status = url.searchParams.get('status') || '';
  if (status) {
    if (!STATUS.includes(status)) return apiError(400, 'VALIDATION', 'Status tidak dikenal.', { fields: { status: STATUS.join('|') } });
    tambah('status = ?', status);
  }
  const mitra = url.searchParams.get('mitra') || '';
  if (mitra && user.role !== 'mitra') tambah('mitra_id = ?', mitra);
  const pml = url.searchParams.get('pml') || '';
  if (pml && user.role === 'admin') tambah('pml_id = ?', pml);
  const jenis = url.searchParams.get('jenis') || '';
  if (jenis) tambah('jenis = ?', jenis);
  const sampel = url.searchParams.get('sampel') || '';
  if (sampel) tambah('sampel_id = ?', sampel);
  const tab = url.searchParams.get('tab') || '';
  if (tab) tambah('tab_id = ?', tab);
  const aktif = url.searchParams.get('aktif') === '1';
  if (aktif) where.push("status NOT IN ('ditutup', 'dibatalkan')");
  const sqlWhere = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const { results } = await db.prepare('SELECT * FROM koreksi' + sqlWhere + ' ORDER BY diubah DESC LIMIT 500').bind(...args).all();
  const data = (results || []).map(r => bentuk(r, ctx.akun));
  const jumlah = Object.fromEntries(STATUS.map(s => [s, 0]));
  for (const d of data) jumlah[d.status]++;
  return apiOk({ data, meta: { total: data.length, jumlah, belumDibaca: jumlah.terkirim } });
}

export async function detailKoreksi(ctx, user, id) {
  const db = appDb(ctx.env);
  if (!db) return belumAktif();
  const row = await ambil(db, id);
  if (!bolehLihat(user, row)) return tidakAda();
  const { results } = await db.prepare('SELECT waktu, oleh, peran, aksi, dari_status, ke_status, catatan FROM koreksi_log WHERE koreksi_id = ?1 ORDER BY id').bind(id).all();
  const riwayat = (results || []).map(r => ({
    waktu: r.waktu,
    oleh: { id: r.oleh, nama: (ctx.akun.find(a => a.id === r.oleh) || {}).nama || '' },
    peran: r.peran,
    aksi: r.aksi,
    dari: r.dari_status,
    ke: r.ke_status,
    catatan: r.catatan,
  }));
  return apiOk({ ...bentuk(row, ctx.akun), riwayat });
}

// helper dari api-v1: { findRecord, link, canRead }
export async function buat(request, ctx, user, bantu) {
  const db = appDb(ctx.env);
  if (!db) return belumAktif();
  if (user.role !== 'pml') return apiError(403, 'FORBIDDEN', 'Hanya PML yang dapat mengirim koreksi.');
  const body = await readJson(request);
  const fields = {};
  const catatan = teks(body.catatan, MAKS_CATATAN);
  if (!catatan || catatan.length > MAKS_CATATAN) fields.catatan = 'Catatan harus 1 sampai 1000 karakter.';
  const bagian = teks(body.bagian, 60);
  if (bagian.length > 60) fields.bagian = 'Bagian maksimal 60 karakter.';
  const r = body.rujukan || {};
  const tipe = r.tipe || (r.tabId ? 'monitoring' : 'sampel');
  let mitraId = null;
  let isi = {};
  if (tipe === 'sampel') {
    if (!['pengeringan', 'penggilingan'].includes(r.jenis)) fields['rujukan.jenis'] = 'Jenis harus pengeringan atau penggilingan.';
    if (!r.id) fields['rujukan.id'] = 'ID sampel wajib.';
    if (Object.keys(fields).length) return salahValidasi(fields);
    const rec = bantu.findRecord(ctx, r.jenis, String(r.id));
    if (!rec) return apiError(404, 'NOT_FOUND', 'Sampel tidak ditemukan.');
    if (!bantu.canRead(user, rec, ctx)) return apiError(403, 'FORBIDDEN', 'Sampel ini bukan bimbingan Anda.');
    const { mitra } = bantu.link(ctx, rec);
    if (!mitra) return apiError(422, 'MITRA_TIDAK_TERHUBUNG', 'Sampel ini belum terhubung ke akun mitra.', { retryable: false });
    mitraId = mitra.id;
    isi = { jenis: r.jenis, sampel_id: String(r.id), tab_id: null, baris: null };
  } else if (tipe === 'monitoring') {
    const tab = r.tabId ? cariTab({ id: String(r.tabId) }) : null;
    if (!tab) fields['rujukan.tabId'] = 'Tab monitoring tidak dikenal.';
    const baris = teks(r.baris, 120);
    if (!baris || baris.length > 120) fields['rujukan.baris'] = 'Kunci baris harus 1 sampai 120 karakter.';
    if (!r.mitraId) fields['rujukan.mitraId'] = 'Mitra tujuan wajib untuk koreksi monitoring.';
    if (Object.keys(fields).length) return salahValidasi(fields);
    const mitra = ctx.akun.find(a => a.id === String(r.mitraId) && a.role === 'mitra');
    const bimbingan = mitra && String(mitra.pml_id || '').split(',').map(s => s.trim()).includes(user.id);
    if (!bimbingan) return apiError(403, 'FORBIDDEN', 'Mitra itu bukan bimbingan Anda.');
    mitraId = mitra.id;
    isi = { jenis: null, sampel_id: null, tab_id: tab.id, baris };
  } else {
    fields['rujukan.tipe'] = 'Tipe harus sampel atau monitoring.';
  }
  if (Object.keys(fields).length) return salahValidasi(fields);
  const mitraAkun = ctx.akun.find(a => a.id === mitraId);
  if (mitraAkun && mitraAkun.aktif === false) return apiError(422, 'MITRA_NONAKTIF', 'Akun mitra tujuan sedang nonaktif.', { retryable: false });
  const id = idBaru();
  const waktu = waktuSekarang(ctx.env);
  const ins = db.prepare('INSERT INTO koreksi (id, tipe, jenis, sampel_id, tab_id, baris, bagian, catatan, mitra_id, pml_id, status, versi, dibuat, diubah) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?12)')
    .bind(id, tipe, isi.jenis, isi.sampel_id, isi.tab_id, isi.baris, bagian, catatan, mitraId, user.id, 'terkirim', waktu);
  const lg = await log(db, { id, waktu, user, aksi: 'buat', dari: null, ke: 'terkirim', catatan: '' });
  await db.batch([ins, lg]);
  return apiOk(bentuk(await ambil(db, id), ctx.akun), 201);
}

export async function ubah(request, ctx, user, id) {
  const db = appDb(ctx.env);
  if (!db) return belumAktif();
  const row = await ambil(db, id);
  if (!bolehLihat(user, row)) return tidakAda();
  if (user.role !== 'pml') return apiError(403, 'FORBIDDEN', 'Hanya PML pengirim yang dapat mengubah koreksi.');
  if (!BOLEH_UBAH_PML.has(row.status)) return ditolakStatus(row, 'Koreksi tidak bisa diubah setelah ditanggapi');
  const body = await readJson(request);
  const set = {};
  const fields = {};
  if (body.catatan !== undefined) {
    const c = teks(body.catatan, MAKS_CATATAN);
    if (!c || c.length > MAKS_CATATAN) fields.catatan = 'Catatan harus 1 sampai 1000 karakter.';
    else set.catatan = c;
  }
  if (body.bagian !== undefined) {
    const b = teks(body.bagian, 60);
    if (b.length > 60) fields.bagian = 'Bagian maksimal 60 karakter.';
    else set.bagian = b;
  }
  if (Object.keys(fields).length) return salahValidasi(fields);
  if (!Object.keys(set).length) return salahValidasi({ catatan: 'Tidak ada perubahan.' });
  set.status = 'terkirim';
  set.dibaca_at = null;
  const r = await perbarui(db, row, withEnv(user, ctx), { set, aksi: 'ubah', ke: 'terkirim', versiKlien: body.versi });
  if (r.error) return r.error;
  return apiOk(bentuk(r.row, ctx.akun));
}

function withEnv(user, ctx) {
  return { ...user, __env: ctx.env };
}

export async function baca(request, ctx, user, id) {
  const db = appDb(ctx.env);
  if (!db) return belumAktif();
  const row = await ambil(db, id);
  if (!bolehLihat(user, row)) return tidakAda();
  if (user.role !== 'mitra') return apiError(403, 'FORBIDDEN', 'Hanya mitra tujuan yang menandai dibaca.');
  if (row.status !== 'terkirim') return apiOk(bentuk(row, ctx.akun)); // idempoten
  const r = await perbarui(db, row, withEnv(user, ctx), { set: { status: 'dibaca', dibaca_at: w => w }, aksi: 'baca', ke: 'dibaca' });
  if (r.error) return r.error;
  return apiOk(bentuk(r.row, ctx.akun));
}

export async function tanggapi(request, ctx, user, id) {
  const db = appDb(ctx.env);
  if (!db) return belumAktif();
  const row = await ambil(db, id);
  if (!bolehLihat(user, row)) return tidakAda();
  if (user.role !== 'mitra') return apiError(403, 'FORBIDDEN', 'Hanya mitra tujuan yang dapat menanggapi.');
  if (FINAL.has(row.status)) return ditolakStatus(row, 'Koreksi sudah selesai');
  const body = await readJson(request);
  const diperbaiki = body.diperbaiki === true;
  const t = teks(body.tanggapan, MAKS_CATATAN);
  if (t.length > MAKS_CATATAN || (!t && !diperbaiki)) return salahValidasi({ tanggapan: 'Tanggapan 1 sampai 1000 karakter (boleh kosong bila menandai diperbaiki).' });
  const ke = diperbaiki ? 'diperbaiki' : 'ditanggapi';
  const set = { status: ke, tanggapan: t, ditanggapi_at: w => w };
  if (!row.dibaca_at) set.dibaca_at = w => w;
  const r = await perbarui(db, row, withEnv(user, ctx), { set, aksi: diperbaiki ? 'perbaiki' : 'tanggapi', ke, catatanLog: t, versiKlien: body.versi });
  if (r.error) return r.error;
  return apiOk(bentuk(r.row, ctx.akun));
}

export async function tutup(request, ctx, user, id) {
  const db = appDb(ctx.env);
  if (!db) return belumAktif();
  const row = await ambil(db, id);
  if (!bolehLihat(user, row)) return tidakAda();
  if (user.role !== 'pml' && user.role !== 'admin') return apiError(403, 'FORBIDDEN', 'Hanya PML pengirim atau admin yang dapat menutup koreksi.');
  if (FINAL.has(row.status)) return ditolakStatus(row, 'Koreksi sudah selesai');
  const body = await readJson(request);
  const c = teks(body.catatan, 300);
  const r = await perbarui(db, row, withEnv(user, ctx), { set: { status: 'ditutup', ditutup_at: w => w }, aksi: 'tutup', ke: 'ditutup', catatanLog: c.slice(0, 300), versiKlien: body.versi });
  if (r.error) return r.error;
  return apiOk(bentuk(r.row, ctx.akun));
}

export async function bukaLagi(request, ctx, user, id) {
  const db = appDb(ctx.env);
  if (!db) return belumAktif();
  const row = await ambil(db, id);
  if (!bolehLihat(user, row)) return tidakAda();
  if (user.role !== 'pml') return apiError(403, 'FORBIDDEN', 'Hanya PML pengirim yang dapat membuka lagi koreksi.');
  if (!['ditanggapi', 'diperbaiki', 'ditutup'].includes(row.status)) return ditolakStatus(row, 'Hanya koreksi yang sudah ditanggapi atau ditutup yang bisa dibuka lagi');
  const body = await readJson(request);
  const c = teks(body.catatan, MAKS_CATATAN);
  if (!c || c.length > MAKS_CATATAN) return salahValidasi({ catatan: 'Jelaskan apa yang masih perlu diperbaiki (1 sampai 1000 karakter).' });
  const r = await perbarui(db, row, withEnv(user, ctx), { set: { status: 'terkirim', dibaca_at: null, ditutup_at: null }, aksi: 'buka', ke: 'terkirim', catatanLog: c, versiKlien: body.versi });
  if (r.error) return r.error;
  return apiOk(bentuk(r.row, ctx.akun));
}

// DELETE: PML = batalkan (sebelum ditanggapi); admin = hapus lunak (sembunyikan dari PML/mitra).
export async function hapus(request, ctx, user, id) {
  const db = appDb(ctx.env);
  if (!db) return belumAktif();
  const row = await ambil(db, id);
  if (!bolehLihat(user, row)) return tidakAda();
  const body = await readJson(request);
  if (user.role === 'pml') {
    if (!BOLEH_UBAH_PML.has(row.status)) return ditolakStatus(row, 'Koreksi tidak bisa dibatalkan setelah ditanggapi');
    const r = await perbarui(db, row, withEnv(user, ctx), { set: { status: 'dibatalkan', ditutup_at: w => w }, aksi: 'batal', ke: 'dibatalkan', catatanLog: teks(body.alasan, 300).slice(0, 300), versiKlien: body.versi });
    if (r.error) return r.error;
    return apiOk(bentuk(r.row, ctx.akun));
  }
  if (user.role === 'admin') {
    if (Number(row.dihapus)) return apiOk(bentuk(row, ctx.akun));
    const r = await perbarui(db, row, withEnv(user, ctx), { set: { dihapus: 1, dihapus_at: w => w, dihapus_oleh: user.id }, aksi: 'hapus', catatanLog: teks(body.alasan, 300).slice(0, 300) });
    if (r.error) return r.error;
    return apiOk(bentuk(r.row, ctx.akun));
  }
  return apiError(403, 'FORBIDDEN', 'Mitra tidak dapat menghapus koreksi.');
}

export async function pulihkan(request, ctx, user, id) {
  const db = appDb(ctx.env);
  if (!db) return belumAktif();
  if (user.role !== 'admin') return apiError(403, 'FORBIDDEN', 'Hanya admin yang dapat memulihkan koreksi.');
  const row = await ambil(db, id);
  if (!row) return tidakAda();
  if (!Number(row.dihapus)) return apiOk(bentuk(row, ctx.akun));
  const r = await perbarui(db, row, withEnv(user, ctx), { set: { dihapus: 0, dihapus_at: null, dihapus_oleh: null }, aksi: 'pulihkan' });
  if (r.error) return r.error;
  return apiOk(bentuk(r.row, ctx.akun));
}
