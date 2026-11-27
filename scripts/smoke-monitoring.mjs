// Uji monitoring v2 (B12). Semua data uji SINTETIS; tidak ada panggilan ke Google.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = rel => import(pathToFileURL(path.join(root, rel)).href);
let jumlahUji = 0;
function cek(kondisi, pesan) {
  jumlahUji++;
  if (!kondisi) {
    console.error('GAGAL: ' + pesan);
    process.exit(1);
  }
}

class MemoryKV {
  constructor() { this.map = new Map(); this.puts = 0; this.gets = 0; }
  async get(key) { this.gets++; return this.map.has(key) ? this.map.get(key) : null; }
  async put(key, value) { this.puts++; this.map.set(key, value); }
  async delete(key) { this.map.delete(key); }
}

function respon(status, body, { url = 'https://doc-0s-contoh.googleusercontent.com/export', type = 'text/csv' } = {}) {
  return { status, ok: status >= 200 && status < 300, url, headers: new Headers({ 'content-type': type }), text: async () => body };
}

const katalogMod = await imp('functions/lib/katalog.js');
const gsheet = await imp('functions/lib/gsheet.js');
const samaran = await imp('functions/lib/samaran.js');
const ringkasanMod = await imp('functions/lib/ringkasan.js');
const monitoring = await imp('functions/lib/monitoring.js');
const situs = await imp('scripts/lib/katalog-sites.mjs');
const doc = JSON.parse(await readFile(path.join(root, 'data/monitoring-katalog.json'), 'utf8'));
const S = doc.sheets;

// ---------- 1. Integritas katalog ----------
cek(doc.versi === 2 && S.length === 70, 'katalog 70 tab versi 2');
cek(new Set(S.map(s => s.id)).size === S.length, 'id unik');
cek(new Set(S.map(s => s.sid + ':' + s.gid)).size === S.length, 'sid:gid unik');
const HOST_OK = /^(docs\.google\.com|drive\.google\.com|forms\.gle|s\.bps\.go\.id|bit\.ly|sites\.google\.com)$/;
for (const s of S) {
  cek(['tp', 'inpek', 'horti'].includes(s.bidang), 'bidang ' + s.id);
  cek(Number.isInteger(s.tahun) && s.arsip === (s.tahun < 2026), 'arsip = tahun<2026 ' + s.id);
  cek(s.label && s.survei, 'label/survei ' + s.id);
  cek(/^[A-Za-z0-9_-]{20,}$/.test(s.sid) && /^\d+$/.test(s.gid), 'sid/gid valid ' + s.id);
  if (s.tersedia === false) cek(['SHEET_FORMAT_UNSUPPORTED', 'SHEET_REMOVED'].includes(s.alasan && s.alasan.kode) && s.alasan.pesan, 'alasan ' + s.id);
  else cek(s.tersedia === true && !s.alasan, 'tersedia ' + s.id);
  if (s.ringkasan) {
    cek(s.bidang === 'tp' && !s.arsip && s.tersedia, 'ringkasan hanya TP aktif ' + s.id);
    cek(s.ringkasan.kunci && s.ringkasan.sudah && ['sama', 'terisi'].includes(s.ringkasan.sudah.aturan), 'peta ringkasan ' + s.id);
    if (s.ringkasan.sudah.aturan === 'sama') cek(Array.isArray(s.ringkasan.sudah.nilai) && s.ringkasan.sudah.nilai.length, 'nilai sama ' + s.id);
  }
  for (const t of s.tautan) {
    const u = new URL(t.url);
    cek(/^https?:$/.test(u.protocol) && HOST_OK.test(u.hostname), 'host tautan ' + s.id + ' ' + u.hostname);
    cek(['form', 'drive', 'lain'].includes(t.jenis), 'jenis tautan ' + s.id);
  }
}
cek(S.filter(s => s.arsip).length === 27, '27 tab arsip');
cek(S.filter(s => s.tersedia === false).length === 11, '11 tab dilewati');
cek(S.filter(s => s.ringkasan).length === 12, '12 tab TP berpeta ringkasan');
cek(JSON.stringify(doc).match(/\b\d{16}\b/) === null, 'katalog tanpa angka 16 digit');
cek(!/[?&](ouid|authuser)=/.test(JSON.stringify(doc)), 'tautan tanpa ouid/authuser');
cek(situs.bersihkanUrl('https://docs.google.com/forms/d/e/x/viewform?usp=sharing&ouid=1') === 'https://docs.google.com/forms/d/e/x/viewform', 'bersihkanUrl');

// ---------- 2. Parser Google Sites (HTML sintetis) ----------
const html = await readFile(path.join(root, 'scripts/fixtures/monitoring/situs-contoh.html'), 'utf8');
const hasilSitus = situs.parseHalaman(html, 'tp');
cek(hasilSitus.length === 3, 'parser menemukan 3 tab (termasuk tombol <a><p>)');
cek(hasilSitus[0].gid === '111' && hasilSitus[1].gid === '222' && hasilSitus[2].gid === '0', 'gid dari #gid, ?gid, dan default 0');
cek(hasilSitus[0].tautan.map(t => t.jenis).join() === 'form,drive' && hasilSitus[1].tautan.length === 2, 'tautan form/drive per tab');
cek(hasilSitus[2].tautan.length === 0 && hasilSitus[2].bagian === 'Survei Lain 2025', 'run direset per h2');
const beda = situs.bandingkan([], hasilSitus);
cek(beda.baru.length === 3 && beda.hilang.length === 0, 'bandingkan katalog vs situs');

// ---------- 3. Katalog API: arsip & peran ----------
const admin = { id: 'a', role: 'admin' };
const pml = { id: 'p', role: 'pml' };
const mitra = { id: 'm', role: 'mitra' };
const u = q => new URL('https://pages.example/api/x' + q);
const kAdmin = await (await monitoring.katalog(u(''), admin)).json();
cek(kAdmin.data.length === 43 && kAdmin.data.every(d => !d.arsip), 'arsip tersembunyi default (43 tab)');
const kArsip = await (await monitoring.katalog(u('?arsip=1'), admin)).json();
cek(kArsip.data.length === 70 && kArsip.meta.arsipDitampilkan === true, 'arsip=1 menampilkan 70 tab');
const kTp = await (await monitoring.katalog(u('?bidang=tp'), pml)).json();
cek(kTp.data.length === 15 && kTp.data.every(d => d.bidang === 'tp'), 'filter bidang tp (PML boleh)');
cek((await monitoring.katalog(u(''), mitra)).status === 403, 'mitra 403 katalog');
cek((await monitoring.katalog(u('?bidang=xx'), admin)).status === 400, 'bidang tak dikenal 400');
const lama = await (await monitoring.katalogLama(u(''), admin)).json();
cek(lama.sheets.length === 43 && ['bidang', 'survei', 'label', 'sid', 'gid'].every(k => k in lama.sheets[0]), 'kompat /api/gsheets');

// ---------- 4. Kode galat jujur ----------
const aktif = S.find(s => s.tersedia && !s.arsip && !s.ringkasan);
let panggilan = 0;
async function galatDari(fake, tab = aktif) {
  const env = { SESSIONS: new MemoryKV(), GSHEET_FETCH: async (...a) => { panggilan++; return fake(...a); } };
  const res = await monitoring.tab(u('?id=' + tab.id), env, admin);
  return { status: res.status, body: await res.json() };
}
let g = await galatDari(() => respon(400, 'bad'));
cek(g.status === 502 && g.body.error.code === 'SHEET_EXPORT_REJECTED' && g.body.error.retryable === false && g.body.error.sumber.id === aktif.id, '400 -> SHEET_EXPORT_REJECTED');
g = await galatDari(() => respon(200, '<!doctype html><html>', { url: 'https://accounts.google.com/ServiceLogin', type: 'text/html' }));
cek(g.status === 403 && g.body.error.code === 'SHEET_NOT_PUBLIC', 'redirect login -> SHEET_NOT_PUBLIC');
g = await galatDari(() => respon(200, '<html><body>x</body></html>', { type: 'text/html' }));
cek(g.body.error.code === 'SHEET_NOT_PUBLIC', 'HTML -> SHEET_NOT_PUBLIC');
g = await galatDari(() => respon(404, ''));
cek(g.status === 410 && g.body.error.code === 'SHEET_REMOVED', '404 -> SHEET_REMOVED');
g = await galatDari(() => respon(500, ''));
cek(g.status === 503 && g.body.error.code === 'SOURCE_UNAVAILABLE' && g.body.error.retryable === true, '500 -> SOURCE_UNAVAILABLE');
g = await galatDari(() => { throw new Error('jaringan'); });
cek(g.status === 503 && g.body.error.code === 'SOURCE_UNAVAILABLE', 'jaringan -> SOURCE_UNAVAILABLE');
panggilan = 0;
for (const s of S.filter(s => s.tersedia === false)) {
  g = await galatDari(() => respon(200, 'a,b,c\n1,2,3\n'), s);
  const st = s.alasan.kode === 'SHEET_REMOVED' ? 410 : 422;
  cek(g.status === st && g.body.error.code === s.alasan.kode && g.body.error.message === s.alasan.pesan, 'tab dilewati ' + s.id);
}
cek(panggilan === 0, 'tab dilewati tidak memanggil Google');
g = await galatDari(() => respon(200, ''), { id: 'tidak-ada' });
cek(g.status === 404 && g.body.error.code === 'NOT_FOUND', 'id tak dikenal 404');
cek((await monitoring.tab(u(''), {}, admin)).status === 400, 'tanpa id 400');
cek((await monitoring.tab(u('?id=' + aktif.id), {}, mitra)).status === 403, 'mitra 403 tab');

// ---------- 5. Deteksi header ----------
cek(gsheet.deteksiHeader(gsheet.parseCsv('Judul,,,\nSub,,,\na,b,c,d\n1,2,3,4\n')) === 3, 'header setelah 2 baris judul');
cek(gsheet.deteksiHeader(gsheet.parseCsv('a,b,c\n1,2,3\n')) === 1, 'header baris 1');
cek(gsheet.deteksiHeader(gsheet.parseCsv('Judul,,,\na,b,c,d\n'), 1) === 1, 'headerRow katalog menang');
cek(gsheet.deteksiHeader([]) === 0, 'kosong -> 0');

// ---------- 6. Penyamaran PML ----------
const csvSensitif = await readFile(path.join(root, 'scripts/fixtures/monitoring/sensitif.csv'), 'utf8');
const tab3 = S.find(s => s.tersedia && s.headerRow === 3);
const envS = { SESSIONS: new MemoryKV(), GSHEET_CSV: { [tab3.sid + ':' + tab3.gid]: csvSensitif } };
const full = await (await monitoring.tab(u('?id=' + tab3.id), envS, admin)).json();
cek(full.meta.disamarkan === false && full.headerRow === 3 && full.rows[3][3] === '9900110101990001', 'admin melihat data penuh');
const pmlRes = await (await monitoring.tab(u('?id=' + tab3.id), envS, pml)).json();
const R = pmlRes.rows;
const H = pmlRes.header;
const col = n => H.indexOf(n);
cek(pmlRes.meta.disamarkan === true, 'PML meta.disamarkan');
cek(R[3][col('NIK')] === '9900********0001', 'NIK disamarkan 4+4');
cek(R[4][col('NIK')] === '-', 'penanda "-" dibiarkan');
cek(R[3][col('No HP')] === '*********001' && R[5][col('No HP')] === '**********003' && R[4][col('No HP')] === '#N/A', 'HP sisakan 3 digit');
cek(R[3][col('Email PCL')] === '***@example.test', 'email disamarkan');
cek(R[3][col('Alamat')] === '[disamarkan]' && R[5][col('Alamat')] === '', 'alamat disamarkan, kosong tetap kosong');
cek(R[3][col('Nama Responden')] === 'Contoh S. D.' && R[4][col('Nama Responden')] === 'T***', 'nama responden disingkat');
cek(R[3][col('PCL')] === 'Petugas Uji A' && R[3][col('PML')] === 'Pengawas Uji A', 'nama petugas dibiarkan');
cek(R[3][col('Kode Identitas')] === '1234567890123456', 'kode identitas 16 digit bukan NIK');
cek(R[3][10] === '[disamarkan]', 'kolom tanpa header disamarkan penuh');
cek(R[4][10] === '[disamarkan]', 'kolom tanpa header disamarkan (termasuk teks bebas)');
cek(R[0][0] === 'DATA SINTETIS UNTUK UJI', 'baris judul dipertahankan');
const teks = JSON.stringify(pmlRes);
cek(!/9900110101990001|081200000001|petugas\.contoh@|Jl\. Contoh|Satu Dua/.test(teks), 'tidak ada nilai sensitif mentah di JSON PML');
cek(pmlRes.meta.kolomDisamarkan.map(k => k.jenis).sort().join() === ['nik', 'telp', 'email', 'penuh', 'singkat', 'penuh'].sort().join(), 'daftar kolomDisamarkan');
const ulangAdmin = await (await monitoring.tab(u('?id=' + tab3.id), envS, admin)).json();
cek(ulangAdmin.rows[3][3] === '9900110101990001', 'cache tidak ikut tersamarkan');
const pindai = samaran.pindaiNilai('catatan 9900110101990002 / 081200000002 / a.b@example.test');
cek(pindai.nilai === 'catatan 9900********0002 / *********002 / ***@example.test', 'pindai pola di sel bebas');
cek(samaran.pindaiNilai('-7.1234567890123456').berubah === false, 'koordinat desimal tidak dianggap NIK');

// ---------- 7. Ringkasan TP ----------
const ksa = S.find(s => s.ringkasan && s.ringkasan.sudah.aturan === 'sama' && s.ringkasan.kunci === 'ID Sub Segmen');
const csvKsa = [
  'Monitoring KSA (sintetis),,,,,',
  'ID Sub Segmen,Nama Kec,PCS,PML,Sudah Kirim Foto,Catatan',
  'S001,Kec Satu,Petugas A,Pengawas A,Sudah Kirim Foto,',
  'S002,Kec Satu,Petugas A,Pengawas A,sudah kirim foto ,',
  'S003,Kec Dua,Petugas B,Pengawas B,Belum Kirim Foto,',
  'S004,Kec Dua,Petugas B,Pengawas B,,',
  ',Kec Dua,Petugas B,Pengawas B,Sudah Kirim Foto,baris tanpa kunci',
  'S005,Kec Dua,Petugas B,Pengawas B,#N/A,',
].join('\n');
const envK = { SESSIONS: new MemoryKV(), GSHEET_CSV: { [ksa.sid + ':' + ksa.gid]: csvKsa } };
const rk = await (await monitoring.ringkasan(u('?id=' + ksa.id), envK, pml)).json();
cek(rk.total === 5 && rk.sudah === 2 && rk.belum === 3 && rk.persen === 40, 'ringkasan KSA aturan sama ' + JSON.stringify([rk.total, rk.sudah]));
cek(rk.perPml.length === 2 && rk.perPml[0].pml === 'Pengawas A' && rk.perPml[0].sudah === 2, 'per PML');
cek(rk.perKecamatan.find(k => k.kecamatan === 'Kec Dua').total === 3, 'per kecamatan');
cek(rk.rincian.find(r => r.nilai === '(kosong)').jumlah === 1 && rk.definisi.kolomStatus === 'Sudah Kirim Foto', 'rincian + definisi');
const ter = S.find(s => s.ringkasan && s.ringkasan.sudah.aturan === 'terisi' && s.ringkasan.kunci === 'Kode Identitas' && s.ringkasan.kecamatan === 'Kecamatan');
const m = ter.ringkasan;
const csvTer = [
  [m.kunci, m.kecamatan, m.pcl, m.pml, m.sudah.kolom].join(','),
  ['K1', 'Kec A', 'P1', 'M1', '1. Berhasil'].join(','),
  ['K2', 'Kec A', 'P1', 'M1', '-'].join(','),
  ['K3', 'Kec B', 'P2', 'M2', '#REF!'].join(','),
  ['K4', 'Kec B', 'P2', 'M2', '3. Tidak berhasil'].join(','),
].join('\n');
const hr = ringkasanMod.hitungRingkasan(m, gsheet.parseCsv(csvTer), 1);
cek(hr.ok && hr.total === 4 && hr.sudah === 2, 'aturan terisi abaikan "-" dan #REF!');
const hilang = ringkasanMod.hitungRingkasan(m, gsheet.parseCsv('a,b,c\n1,2,3\n'), 1);
cek(!hilang.ok && hilang.code === 'RINGKASAN_KOLOM_HILANG' && hilang.kolom.includes(m.kunci), 'kolom hilang terdeteksi');
const envH = { SESSIONS: new MemoryKV(), GSHEET_CSV: { [ter.sid + ':' + ter.gid]: 'a,b,c\n1,2,3\n' } };
const rh = await monitoring.ringkasan(u('?id=' + ter.id), envH, admin);
cek(rh.status === 422 && (await rh.json()).error.code === 'RINGKASAN_KOLOM_HILANG', 'API 422 kolom hilang');
const arsipTp = S.find(s => s.bidang === 'tp' && s.arsip);
cek((await monitoring.ringkasan(u('?id=' + arsipTp.id), {}, admin)).status === 422, 'arsip TP belum dipetakan 422');
cek((await monitoring.ringkasan(u('?bidang=inpek'), {}, admin)).status === 422, 'ringkasan non-TP 422');
cek((await monitoring.ringkasan(u('?bidang=tp'), {}, mitra)).status === 403, 'mitra 403 ringkasan');

// ---------- 8. Batas subrequest batch ----------
const petaTp = S.filter(s => s.ringkasan);
function csvDari(s) {
  const r = s.ringkasan;
  const kol = [r.kunci, r.kecamatan, r.pcl, r.pml, r.sudah.kolom].filter(Boolean);
  const nilai = r.sudah.aturan === 'sama' ? r.sudah.nilai[0] : 'isi';
  const judul = 'Judul sintetis' + ','.repeat(kol.length - 1) + '\n';
  return judul.repeat((s.headerRow || 1) - 1) + kol.join(',') + '\n' + kol.map((k, i) => (i === kol.length - 1 ? nilai : 'v' + i)).join(',') + '\n';
}
const kvB = new MemoryKV();
let ambil = 0;
const envB = {
  SESSIONS: kvB,
  GSHEET_FETCH: async url => {
    ambil++;
    const sid = decodeURIComponent(url.split('/d/')[1].split('/')[0]);
    const gid = url.split('gid=')[1];
    return respon(200, csvDari(petaTp.find(s => s.sid === sid && s.gid === gid)));
  },
};
const b1 = await (await monitoring.ringkasan(u('?bidang=tp'), envB, admin)).json();
cek(ambil === monitoring.BATAS_AMBIL_BATCH && b1.meta.diambilDariGoogle === 10, 'batch maksimal 10 ambil Google');
cek(b1.meta.total === 12 && b1.meta.ok === 10 && b1.meta.ditunda === 2, 'sisa tab ditunda');
cek(b1.data.filter(d => d.status === 'ok').every(d => d.total === 1 && d.sudah === 1), 'angka ringkasan batch');
cek(b1.tanpaRingkasan.some(t => t.alasan === 'SHEET_FORMAT_UNSUPPORTED') && b1.tanpaRingkasan.some(t => t.alasan === 'SHEET_REMOVED'), 'tanpaRingkasan berisi tab dilewati');
const b2 = await (await monitoring.ringkasan(u('?bidang=tp'), envB, admin)).json();
cek(ambil === 12 && b2.meta.ok === 12 && b2.meta.ditunda === 0, 'permintaan kedua: cache + 2 sisa');

// ---------- 9. KV hanya ditulis bila berubah ----------
const kvW = new MemoryKV();
let isi = 'a,b,c\n1,2,3\n';
const envW = { SESSIONS: kvW, MON_TTL_S: 0, GSHEET_FETCH: async () => respon(200, isi) };
const t9 = aktif;
let r9 = await gsheet.muatTab(envW, t9);
cek(r9.ok && kvW.puts === 1, 'tulisan pertama');
r9 = await gsheet.muatTab(envW, t9);
r9 = await gsheet.muatTab(envW, t9);
cek(kvW.puts === 1 && r9.kvDitulis === false, 'isi sama -> tanpa tulisan KV');
isi = 'a,b,c\n1,2,4\n';
r9 = await gsheet.muatTab(envW, t9);
cek(kvW.puts === 1 && r9.rows[1][2] === '4', 'berubah tapi < jeda minimum -> tidak tulis, data baru tetap disajikan');
envW.MON_KV_MIN_WRITE_S = 0;
isi = 'a,b,c\n1,2,5\n';
r9 = await gsheet.muatTab(envW, t9);
cek(kvW.puts === 2 && r9.kvDitulis === true, 'berubah dan lewat jeda -> tulis');
const simpanan = JSON.parse(kvW.map.get('mon:v2:' + t9.sid + ':' + t9.gid));
cek(simpanan.hash && simpanan.rows[1][2] === '5' && simpanan.changedAt && simpanan.checkedAt, 'bentuk rekaman KV');
// isolate baru (memori kosong) membaca KV
gsheet.lupakanCache(envW);
envW.MON_TTL_S = 300;
const ambilSebelum = kvW.gets;
r9 = await gsheet.muatTab({ ...envW, GSHEET_FETCH: async () => { throw new Error('tidak boleh'); } }, t9);
cek(r9.ok && r9.rows[1][2] === '5' && kvW.gets === ambilSebelum + 1, 'baca dari KV dalam TTL tanpa Google');
// gagal remote + salinan terakhir -> stale
gsheet.lupakanCache(envW);
r9 = await gsheet.muatTab({ ...envW, MON_TTL_S: 0, GSHEET_FETCH: async () => respon(503, '') }, t9);
cek(r9.ok && r9.stale === true && r9.error.code === 'SOURCE_UNAVAILABLE', 'stale dengan meta.error');

console.log('smoke monitoring ok (' + jumlahUji + ' cek)');
