// Uji CRUD + koreksi PML -> mitra. Semua data SINTETIS, store memori, D1 in-memory (node:sqlite).
// Tidak memanggil Apps Script, Google Sheet, atau D1 remote mana pun.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createD1 } from './lib/d1-sqlite.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = rel => import(pathToFileURL(path.join(root, rel)).href);
let n = 0;
function cek(ok, pesan, info) {
  n++;
  if (!ok) {
    console.error('GAGAL: ' + pesan + (info !== undefined ? ' ' + JSON.stringify(info).slice(0, 400) : ''));
    process.exit(1);
  }
}

class MemoryKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, v); }
  async delete(k) { this.map.delete(k); }
}

const pengeringan = [
  'DATA SINTETIS PENGERINGAN,,,,,,,,,',
  'Sub judul,,,,,,,,,',
  'No.,kdkec,nmkec,lokasi,idsubsegmen,nks,flag_ sampel,PCL,PML,Status Sampel',
  '1,010,KEC UJI A,DESA UJI A,S-001,N01,U,MITRA SATU,PENGAWAS SATU,Berhasil dicacah',
  '2,010,KEC UJI A,DESA UJI A,S-002,N02,U,MITRA SATU,PENGAWAS SATU,',
  '3,020,KEC UJI B,DESA UJI B,S-003,N03,C,MITRA DUA,PENGAWAS SATU,',
  '4,030,KEC UJI C,DESA UJI C,S-004,N04,U,MITRA TIGA,PENGAWAS DUA,',
].join('\n');
const penggilingan = [
  'DATA SINTETIS PENGGILINGAN,,,,,,,,',
  'Sub judul,,,,,,,,',
  'No.,Kode Kecamatan,Nama Kecamatan,ID SBR,Nama Usaha/Perusahaan,Jenis Sampel,PCL,PML,Hasil Pencacahan',
  '1,030,KEC UJI C,G-001,USAHA UJI,U,MITRA TIGA,PENGAWAS DUA,',
].join('\n');

const schema = await readFile(path.join(root, 'migrations-app/0001_koreksi_audit.sql'), 'utf8');
const storeMod = await imp('functions/lib/store.js');
const handle = await imp('functions/lib/handle.js');
const kv = new MemoryKV();
const store = storeMod.createMemoryStore();
let dbLamaDisentuh = 0;
const env = {
  SESSIONS: kv,
  SHEET_CSV: { pengeringan, penggilingan },
  store,
  // Binding DB lama (produksi bersama) tidak boleh disentuh sama sekali.
  DB: new Proxy({}, { get() { dbLamaDisentuh++; throw new Error('DB lama disentuh'); } }),
};

async function call(p, { method = 'GET', token, json, body } = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', 'Bearer ' + token);
  const init = { method, headers };
  if (json !== undefined) { headers.set('content-type', 'application/json'); init.body = JSON.stringify(json); }
  if (body) init.body = body;
  const res = await handle.dispatch(new Request('https://pages.example' + p, init), env);
  const type = res.headers.get('content-type') || '';
  const js = type.includes('json') ? await res.json() : null;
  return { status: res.status, json: js, code: js && js.error && js.error.code };
}
async function login(id) {
  const r = await call('/api/login', { method: 'POST', json: { id, password: id } });
  cek(r.status === 200, 'login ' + id, r.json);
  return r.json.token;
}

// ---------- Akun sintetis ----------
const A = await login('3305');
const akun = (await call('/api/admin/akun', { token: A })).json.data;
const id = nama => akun.find(a => a.nama === nama).id;
const M1 = id('MITRA SATU'), M2 = id('MITRA DUA'), M3 = id('MITRA TIGA');
const P1 = id('PENGAWAS SATU'), P2 = id('PENGAWAS DUA');
const tM1 = await login(M1), tM2 = await login(M2), tM3 = await login(M3), tP1 = await login(P1), tP2 = await login(P2);

// ---------- Tanpa APPDB: fitur butuh audit -> 503 ----------
let r = await call('/api/koreksi', { token: tP1 });
cek(r.status === 503 && r.code === 'FITUR_BELUM_AKTIF', 'tanpa APPDB koreksi 503', r);
r = await call('/api/admin/akun/' + M3, { method: 'PATCH', token: A, json: { aktif: false } });
cek(r.status === 503, 'tanpa APPDB ubah akun 503');

const d1 = createD1(schema);
env.APPDB = d1;

// ---------- Koreksi: buat & hak akses ----------
r = await call('/api/koreksi', { method: 'POST', token: tM1, json: { rujukan: { jenis: 'pengeringan', id: 'S-001' }, catatan: 'x' } });
cek(r.status === 403, 'mitra tidak bisa membuat koreksi');
r = await call('/api/koreksi', { method: 'POST', token: A, json: { rujukan: { jenis: 'pengeringan', id: 'S-001' }, catatan: 'x' } });
cek(r.status === 403, 'admin tidak membuat koreksi (peran PML)');
r = await call('/api/koreksi', { method: 'POST', token: tP1, json: { rujukan: { jenis: 'pengeringan', id: 'S-004' }, catatan: 'bukan bimbingan' } });
cek(r.status === 403, 'PML tidak bisa koreksi sampel PML lain', r.json);
r = await call('/api/koreksi', { method: 'POST', token: tP1, json: { rujukan: { jenis: 'pengeringan', id: 'S-003' }, catatan: '' } });
cek(r.status === 422 && r.json.error.fields.catatan, 'catatan kosong 422');
r = await call('/api/koreksi', { method: 'POST', token: tP1, json: { rujukan: { jenis: 'pengeringan', id: 'S-999' }, catatan: 'a' } });
cek(r.status === 404, 'sampel tidak ada 404');
r = await call('/api/koreksi', { method: 'POST', token: tP1, json: { rujukan: { jenis: 'pengeringan', id: 'S-003' }, bagian: 'foto.ka_1', catatan: 'Foto kadar air amatan 1 buram, mohon unggah ulang.' } });
cek(r.status === 201 && r.json.status === 'terkirim' && r.json.mitra.id === M2 && r.json.pml.id === P1 && /^K[0-9a-f]{16}$/.test(r.json.id), 'PML membuat koreksi', r.json);
const K1 = r.json.id;

// Terima: hanya mitra tujuan
r = await call('/api/koreksi', { token: tM2 });
cek(r.status === 200 && r.json.data.length === 1 && r.json.data[0].id === K1 && r.json.meta.belumDibaca === 1, 'mitra tujuan menerima koreksi', r.json);
r = await call('/api/koreksi/' + K1, { token: tM2 });
cek(r.status === 200 && r.json.riwayat.length === 1 && r.json.riwayat[0].aksi === 'buat', 'mitra tujuan membuka detail');
for (const [t, label] of [[tM1, 'mitra lain'], [tM3, 'mitra lain 2'], [tP2, 'PML lain']]) {
  r = await call('/api/koreksi', { token: t });
  cek(r.status === 200 && r.json.data.length === 0, label + ' tidak melihat di daftar');
  r = await call('/api/koreksi/' + K1, { token: t });
  cek(r.status === 404 && r.code === 'NOT_FOUND', label + ' detail 404');
  r = await call('/api/koreksi/' + K1, { method: 'PATCH', token: t, json: { catatan: 'x' } });
  cek(r.status === 404, label + ' ubah 404');
  r = await call('/api/koreksi/' + K1 + '/tanggapi', { method: 'POST', token: t, json: { tanggapan: 'x' } });
  cek(r.status === 404, label + ' tanggapi 404');
  r = await call('/api/koreksi/' + K1, { method: 'DELETE', token: t });
  cek(r.status === 404, label + ' hapus 404');
}
r = await call('/api/koreksi?mitra=' + M2, { token: tP2 });
cek(r.json.data.length === 0, 'PML lain tidak bisa mengintip lewat filter mitra');
r = await call('/api/koreksi/' + K1, { method: 'PATCH', token: tM2, json: { catatan: 'ubah' } });
cek(r.status === 403, 'mitra tidak bisa ubah koreksi');
r = await call('/api/koreksi/' + K1, { method: 'DELETE', token: tM2 });
cek(r.status === 403, 'mitra tidak bisa hapus koreksi');
r = await call('/api/koreksi/' + K1 + '/baca', { method: 'POST', token: tP1 });
cek(r.status === 403, 'PML tidak menandai dibaca');

// Alur status
r = await call('/api/koreksi/' + K1, { method: 'PATCH', token: tP1, json: { catatan: 'Foto KA amatan 1 buram dan miring.', versi: 1 } });
cek(r.status === 200 && r.json.versi === 2 && r.json.status === 'terkirim', 'PML ubah saat terkirim');
r = await call('/api/koreksi/' + K1, { method: 'PATCH', token: tP1, json: { catatan: 'basi', versi: 1 } });
cek(r.status === 409 && r.code === 'CONFLICT', 'versi basi 409');
r = await call('/api/koreksi/' + K1 + '/baca', { method: 'POST', token: tM2 });
cek(r.status === 200 && r.json.status === 'dibaca' && r.json.dibacaAt, 'mitra tandai dibaca');
r = await call('/api/koreksi/' + K1 + '/baca', { method: 'POST', token: tM2 });
cek(r.status === 200 && r.json.status === 'dibaca' && r.json.versi === 3, 'baca idempoten');
r = await call('/api/koreksi/' + K1, { method: 'PATCH', token: tP1, json: { bagian: 'foto.ka_1' } });
cek(r.status === 200 && r.json.status === 'terkirim' && r.json.dibacaAt === null, 'ubah setelah dibaca -> terkirim lagi');
r = await call('/api/koreksi/' + K1 + '/tanggapi', { method: 'POST', token: tM2, json: { tanggapan: '' } });
cek(r.status === 422, 'tanggapan kosong tanpa diperbaiki 422');
r = await call('/api/koreksi/' + K1 + '/tanggapi', { method: 'POST', token: tM2, json: { tanggapan: 'Sudah saya unggah ulang.', diperbaiki: true } });
cek(r.status === 200 && r.json.status === 'diperbaiki' && r.json.tanggapan === 'Sudah saya unggah ulang.' && r.json.dibacaAt, 'mitra tandai diperbaiki');
r = await call('/api/koreksi/' + K1, { method: 'PATCH', token: tP1, json: { catatan: 'telat' } });
cek(r.status === 409 && r.code === 'STATUS_TIDAK_SESUAI', 'PML tidak bisa ubah setelah ditanggapi');
r = await call('/api/koreksi/' + K1, { method: 'DELETE', token: tP1 });
cek(r.status === 409 && r.code === 'STATUS_TIDAK_SESUAI', 'PML tidak bisa batal setelah ditanggapi');
r = await call('/api/koreksi/' + K1 + '/buka', { method: 'POST', token: tP1, json: { catatan: '' } });
cek(r.status === 422, 'buka lagi wajib catatan');
r = await call('/api/koreksi/' + K1 + '/buka', { method: 'POST', token: tP1, json: { catatan: 'Masih buram, ulangi dengan cahaya cukup.' } });
cek(r.status === 200 && r.json.status === 'terkirim', 'PML buka lagi');
r = await call('/api/koreksi/' + K1 + '/tanggapi', { method: 'POST', token: tM2, json: { tanggapan: 'Responden belum bisa ditemui, besok saya ulangi.' } });
cek(r.status === 200 && r.json.status === 'ditanggapi', 'mitra menanggapi');
r = await call('/api/koreksi/' + K1 + '/tutup', { method: 'POST', token: tM2 });
cek(r.status === 403, 'mitra tidak bisa menutup');
r = await call('/api/koreksi/' + K1 + '/tutup', { method: 'POST', token: tP1, json: { catatan: 'OK' } });
cek(r.status === 200 && r.json.status === 'ditutup' && r.json.ditutupAt, 'PML menutup');
r = await call('/api/koreksi/' + K1 + '/tanggapi', { method: 'POST', token: tM2, json: { tanggapan: 'lagi' } });
cek(r.status === 409, 'tanggapi setelah ditutup 409');
r = await call('/api/koreksi/' + K1, { token: tP1 });
cek(r.json.riwayat.map(x => x.aksi).join(',') === 'buat,ubah,baca,ubah,perbaiki,buka,tanggapi,tutup', 'riwayat lengkap', r.json.riwayat.map(x => x.aksi));
cek(r.json.riwayat.every(x => x.oleh.id === P1 || x.oleh.id === M2), 'riwayat hanya pelaku sah');

// Koreksi kedua oleh PML lain + batal
r = await call('/api/koreksi', { method: 'POST', token: tP2, json: { rujukan: { jenis: 'penggilingan', id: 'G-001' }, catatan: 'Hasil pencacahan belum diisi.' } });
cek(r.status === 201 && r.json.mitra.id === M3, 'PML DUA ke MITRA TIGA');
const K2 = r.json.id;
r = await call('/api/koreksi/' + K2, { method: 'DELETE', token: tP2, json: { alasan: 'salah sampel' } });
cek(r.status === 200 && r.json.status === 'dibatalkan', 'PML batal sebelum ditanggapi');
r = await call('/api/koreksi/' + K2, { token: tM3 });
cek(r.status === 200 && r.json.status === 'dibatalkan', 'mitra melihat koreksi dibatalkan');

// Koreksi monitoring
const doc = JSON.parse(await readFile(path.join(root, 'data/monitoring-katalog.json'), 'utf8'));
const tab = doc.sheets.find(s => s.bidang === 'tp' && s.tersedia && !s.arsip);
r = await call('/api/koreksi', { method: 'POST', token: tP1, json: { rujukan: { tipe: 'monitoring', tabId: tab.id, baris: 'KODE-UJI-01', mitraId: M2 }, catatan: 'Status di sheet monitoring belum diperbarui.' } });
cek(r.status === 201 && r.json.tipe === 'monitoring' && r.json.rujukan.label === tab.label, 'koreksi baris monitoring', r.json);
const K3 = r.json.id;
r = await call('/api/koreksi', { method: 'POST', token: tP1, json: { rujukan: { tipe: 'monitoring', tabId: tab.id, baris: 'X', mitraId: M3 }, catatan: 'a' } });
cek(r.status === 403, 'monitoring: mitra bukan bimbingan 403');
r = await call('/api/koreksi', { method: 'POST', token: tP1, json: { rujukan: { tipe: 'monitoring', tabId: 'tidak-ada', baris: 'X', mitraId: M2 }, catatan: 'a' } });
cek(r.status === 422, 'monitoring: tab tak dikenal 422');

// Admin melihat semua + hapus lunak
r = await call('/api/koreksi', { token: A });
cek(r.status === 200 && r.json.data.length === 3, 'admin melihat semua');
r = await call('/api/koreksi?pml=' + P2, { token: A });
cek(r.json.data.length === 1 && r.json.data[0].id === K2, 'admin filter pml');
r = await call('/api/koreksi/' + K3, { method: 'DELETE', token: A, json: { alasan: 'uji' } });
cek(r.status === 200 && r.json.dihapus === true, 'admin hapus lunak');
r = await call('/api/koreksi', { token: tM2 });
cek(r.json.data.length === 1 && r.json.data[0].id === K1, 'koreksi terhapus hilang dari mitra');
r = await call('/api/koreksi/' + K3, { token: tP1 });
cek(r.status === 404, 'koreksi terhapus 404 untuk PML');
r = await call('/api/koreksi?termasukDihapus=1', { token: A });
cek(r.json.data.length === 3, 'admin bisa melihat yang terhapus');
r = await call('/api/koreksi/' + K3 + '/pulihkan', { method: 'POST', token: tP1 });
cek(r.status === 403, 'PML tidak bisa pulihkan');
r = await call('/api/koreksi/' + K3 + '/pulihkan', { method: 'POST', token: A });
cek(r.status === 200 && !r.json.dihapus, 'admin pulihkan');
r = await call('/api/koreksi?status=xx', { token: A });
cek(r.status === 400, 'status tak dikenal 400');

// ---------- Isian: hapus lunak ----------
const opsi = (await call('/api/opsi', { token: tM1 })).json;
r = await call('/api/sampel/pengeringan/S-001/isian', { method: 'PUT', token: tM1, json: { versi: 0, kirim: false, isian: { namaResponden: 'Responden Uji', statusSampel: opsi.statusSampel[0] } } });
cek(r.status === 200 && r.json.status === 'draf', 'mitra simpan draf', r.json);
r = await call('/api/sampel/pengeringan/S-001/isian', { method: 'DELETE', token: tM2, json: { versi: 1 } });
cek(r.status === 403, 'mitra lain tidak bisa hapus isian');
r = await call('/api/sampel/pengeringan/S-001/isian', { method: 'DELETE', token: tP1, json: { versi: 1 } });
cek(r.status === 403, 'PML tidak bisa hapus isian');
r = await call('/api/sampel/pengeringan/S-001/isian', { method: 'DELETE', token: tM1, json: { versi: 0 } });
cek(r.status === 409 && r.code === 'CONFLICT', 'hapus isian versi basi');
r = await call('/api/sampel/pengeringan/S-001/isian', { method: 'DELETE', token: tM1, json: { versi: 1, alasan: 'salah responden' } });
cek(r.status === 200 && r.json.status === 'belum' && r.json.versi === 2, 'mitra hapus draf (lunak)');
r = await call('/api/sampel/pengeringan/S-001', { token: tM1 });
cek(r.json.sampel.status === 'belum' && r.json.isian.namaResponden === '' && r.json.riwayat.map(v => v.aksi).join() === 'simpan,hapus', 'riwayat isian tetap ada', r.json.riwayat);
r = await call('/api/sampel/pengeringan/S-001/isian', { method: 'DELETE', token: tM1, json: { versi: 2 } });
cek(r.status === 404, 'hapus dua kali 404');
r = await call('/api/admin/sampel/pengeringan/S-001/isian/pulihkan', { method: 'POST', token: tM1, json: { versi: 2 } });
cek(r.status === 403, 'mitra tidak bisa pulihkan isian');
r = await call('/api/admin/sampel/pengeringan/S-001/isian/pulihkan', { method: 'POST', token: A, json: { versi: 2 } });
cek(r.status === 200 && r.json.status === 'draf' && r.json.versi === 3, 'admin pulihkan isian');
r = await call('/api/sampel/pengeringan/S-001', { token: A });
cek(r.json.isian.namaResponden === 'Responden Uji', 'isian kembali');
await store.appendIsian({ key: 'pengeringan:S-002', versi: 1, oleh: M1, aksi: 'kirim', waktu: new Date().toISOString(), status: 'sudah', alasan: '', isian: { namaResponden: 'R', nik: '' } });
r = await call('/api/sampel/pengeringan/S-002/isian', { method: 'DELETE', token: tM1, json: { versi: 1 } });
cek(r.status === 409 && r.code === 'LOCKED', 'mitra tidak bisa hapus isian terkirim');
r = await call('/api/sampel/pengeringan/S-002/isian', { method: 'DELETE', token: A, json: { versi: 1, alasan: 'uji admin' } });
cek(r.status === 200, 'admin bisa hapus isian terkirim');

// ---------- Foto: hapus lunak ----------
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const fd = () => { const f = new FormData(); f.append('file', new File([PNG], 'a.png', { type: 'image/png' })); return f; };
r = await call('/api/sampel/pengeringan/S-001/foto/ktp', { method: 'PUT', token: tM1, body: fd() });
cek(r.status === 200, 'unggah foto', r.json);
r = await call('/api/sampel/pengeringan/S-001/foto/ktp', { method: 'DELETE', token: tM2 });
cek(r.status === 403, 'mitra lain tidak bisa hapus foto');
r = await call('/api/sampel/pengeringan/S-001/foto/ktp', { method: 'DELETE', token: tP1 });
cek(r.status === 403, 'PML tidak bisa hapus foto');
r = await call('/api/sampel/pengeringan/S-001/foto/ka_1', { method: 'DELETE', token: tM1 });
cek(r.status === 404, 'hapus slot kosong 404');
await new Promise(res => setTimeout(res, 5));
r = await call('/api/sampel/pengeringan/S-001/foto/ktp', { method: 'DELETE', token: tM1, json: { alasan: 'foto salah' } });
cek(r.status === 200 && r.json.dihapus && r.json.terisi === false, 'mitra hapus foto (lunak)', r.json);
r = await call('/api/foto/pengeringan/S-001/ktp', { token: tM1 });
cek(r.status === 404, 'foto terhapus tidak tersaji');
r = await call('/api/sampel/pengeringan/S-001', { token: tM1 });
cek(r.json.foto.find(f => f.slot === 'ktp').terisi === false, 'detail mengikuti hapus');
r = await call('/api/admin/sampel/pengeringan/S-001/foto/ktp/pulihkan', { method: 'POST', token: A });
cek(r.status === 200, 'admin pulihkan foto');
r = await call('/api/foto/pengeringan/S-001/ktp', { token: tM1 });
cek(r.status === 200, 'foto kembali');

// ---------- Akun: nonaktif lunak ----------
r = await call('/api/admin/akun/' + M3, { method: 'PATCH', token: tP1, json: { aktif: false } });
cek(r.status === 403, 'PML tidak bisa ubah akun');
r = await call('/api/admin/akun/' + M3, { method: 'PATCH', token: A, json: { nama: 'X', aktif: false } });
cek(r.status === 422 && r.json.error.fields.lain, 'nama/peran tidak bisa diubah');
r = await call('/api/admin/akun/' + M3, { method: 'PATCH', token: A, json: { password: 'rahasia', aktif: true } });
cek(r.status === 422, 'password tidak bisa diubah (password = ID)');
r = await call('/api/admin/akun/3305', { method: 'DELETE', token: A });
cek(r.status === 409, 'admin utama terkunci');
r = await call('/api/admin/akun/' + M3, { method: 'DELETE', token: A, json: { alasan: 'kontrak selesai' } });
cek(r.status === 200 && r.json.aktif === false, 'admin nonaktifkan mitra (lunak)');
r = await call('/api/koreksi', { token: tM3 });
cek(r.status === 401 && r.code === 'AKUN_NONAKTIF', 'sesi mitra nonaktif ditolak');
r = await call('/api/login', { method: 'POST', json: { id: M3, password: M3 } });
cek(r.status === 401, 'login mitra nonaktif ditolak');
r = await call('/api/koreksi', { method: 'POST', token: tP2, json: { rujukan: { jenis: 'pengeringan', id: 'S-004' }, catatan: 'a' } });
cek(r.status === 422 && r.code === 'MITRA_NONAKTIF', 'koreksi ke mitra nonaktif ditolak', r.json);
r = await call('/api/admin/akun/' + M3, { method: 'PATCH', token: A, json: { aktif: true } });
cek(r.status === 200 && r.json.aktif === true, 'aktifkan lagi');
await login(M3);

// ---------- Audit ----------
r = await call('/api/admin/audit', { token: tP1 });
cek(r.status === 403, 'audit hanya admin');
r = await call('/api/admin/audit', { token: A });
const aksi = r.json.data.map(x => x.entitas + ':' + x.aksi);
for (const a of ['akun:nonaktifkan', 'akun:aktifkan', 'foto:hapus', 'foto:pulihkan', 'isian:hapus', 'isian:pulihkan']) cek(aksi.includes(a), 'audit ' + a, aksi);

// ---------- Data baca-saja: tidak ada CRUD ----------
for (const [m, p] of [['POST', '/api/monitoring/katalog'], ['PUT', '/api/monitoring/tab?id=' + tab.id], ['DELETE', '/api/gsheet?sid=a&gid=0'], ['POST', '/api/opsi'], ['DELETE', '/api/sampel/pengeringan/S-001'], ['PUT', '/api/sampel/pengeringan/S-001']]) {
  r = await call(p, { method: m, token: A, json: {} });
  cek(r.status === 404 || r.status === 405, 'baca-saja ' + m + ' ' + p, r.status);
}
r = await call('/api/monitoring/katalog', { method: 'POST', token: tP1, json: {} });
cek(r.status === 403, 'PML tidak menulis monitoring');

cek(dbLamaDisentuh === 0, 'binding DB lama tidak disentuh');
console.log('smoke crud+koreksi ok (' + n + ' cek)');
