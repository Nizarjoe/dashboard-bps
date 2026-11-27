import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

class MemoryKV {
  constructor() { this.map = new Map(); }
  async get(key) {
    const row = this.map.get(key);
    if (!row) return null;
    if (row.exp && Date.now() > row.exp) { this.map.delete(key); return null; }
    return row.value;
  }
  async put(key, value, opts) {
    const ttl = opts && opts.expirationTtl;
    this.map.set(key, { value, exp: ttl ? Date.now() + ttl * 1000 : 0 });
  }
  async delete(key) { this.map.delete(key); }
}

const pengeringan = await readFile(path.join(root, 'scripts/fixtures/sheets/pengeringan.csv'), 'utf8');
const penggilingan = await readFile(path.join(root, 'scripts/fixtures/sheets/penggilingan.csv'), 'utf8');
if (/3305\d{12}/.test(pengeringan) || /083191150203|085227535833/.test(penggilingan)) fail('fixture masih memuat data sensitif');

const kv = new MemoryKV();
const env = { SESSIONS: kv, SHEET_CSV: { pengeringan, penggilingan } };

async function call(pathname, opt = {}) {
  const headers = new Headers(opt.headers || {});
  if (opt.token) headers.set('authorization', 'Bearer ' + opt.token);
  const init = { method: opt.method || 'GET', headers };
  if (opt.json) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(opt.json);
  }
  if (opt.body) init.body = opt.body;
  const mod = await import(pathToFileURL(path.join(root, 'functions/lib/handle.js')).href);
  const res = await mod.dispatch(new Request('https://pages.example' + pathname, init), env, opt.exec);
  const type = res.headers.get('content-type') || '';
  const raw = Buffer.from(await res.arrayBuffer());
  const keepBom = type.includes('csv');
  const text = type.includes('json') || keepBom || type.startsWith('text/')
    ? new TextDecoder('utf-8', { ignoreBOM: keepBom }).decode(raw)
    : '';
  let json = null;
  if (type.includes('json')) json = JSON.parse(text);
  return { status: res.status, json, text, raw, headers: res.headers };
}

function auth(token) { return { token }; }

const hmac = await import(pathToFileURL(path.join(root, 'functions/lib/hmac.js')).href);
const signed = await hmac.signBody('rahasia', 'appendIsian', { key: 'a' }, 1_700_000_000);
const seen = new Set();
const okSig = await hmac.verifySigned(signed, 'rahasia', seen, 1_700_000_000);
if (!okSig.ok) fail('HMAC sah ditolak: ' + okSig.error);
const bad = { ...signed, signature: signed.signature.replace(/.$/, signed.signature.endsWith('a') ? 'b' : 'a') };
const badSig = await hmac.verifySigned(bad, 'rahasia', seen, 1_700_000_000);
if (badSig.ok || !/salah/.test(badSig.error)) fail('HMAC salah harus ditolak');
const replay = await hmac.verifySigned(signed, 'rahasia', seen, 1_700_000_000);
if (replay.ok) fail('nonce replay harus ditolak');
const gs = await readFile(path.join(root, 'apps-script/Code.gs'), 'utf8');
if (!gs.includes("String(body.timestamp) + '.' + String(body.nonce) + '.' + stableStringify_(body.payload)")) {
  fail('Apps Script tidak memakai canonical HMAC yang sama');
}
console.log('hmac ok');

const fotoMod = await import(pathToFileURL(path.join(root, 'functions/lib/foto-index.js')).href);
const indeks = fotoMod.latestFotoIndex([
  { jenis: 'pengeringan', id: 'A', slot: 'ktp', waktu: '2026-01-01T00:00:00.000Z', mime: 'image/png', oleh: '1' },
  { jenis: 'pengeringan', id: 'A', slot: 'ktp', waktu: '2026-02-01T00:00:00.000Z', mime: 'image/jpeg', oleh: '2' },
  { jenis: 'pengeringan', id: 'A', slot: 'ka_sebelum_1', waktu: '2026-01-02T00:00:00.000Z' },
  { jenis: 'penggilingan', id: 'B', slot: 'ktp', waktu: '2026-01-03T00:00:00.000Z' },
]);
const slotA = fotoMod.uploadsFor(indeks, 'pengeringan', 'A');
if (slotA.length !== 2 || slotA.find(s => s.slot === 'ktp').waktu !== '2026-02-01T00:00:00.000Z') fail('slot terbaru per sampel');
if (fotoMod.uploadsFor(indeks, 'penggilingan', 'B').length !== 1) fail('indeks tidak memisahkan sampel');
const dariSkrip = fotoMod.indexFotoPayload([
  { jenis: 'pengeringan', id: 'A', slots: [{ slot: 'ktp', waktu: '2026-06-01T00:00:00.000Z', mime: 'image/png', oleh: '1' }] },
]);
if (fotoMod.uploadsFor(dariSkrip, 'pengeringan', 'A')[0].waktu !== '2026-06-01T00:00:00.000Z') fail('payload listFotoAll');
console.log('indeks foto ok');

const akunMod = await import(pathToFileURL(path.join(root, 'functions/lib/akun.js')).href);
const storeMod = await import(pathToFileURL(path.join(root, 'functions/lib/store.js')).href);
const mem = storeMod.createMemoryStore();
await mem.upsertAkun({ id: '3305001', nama: 'ARIF NUROCHMAN', peran: 'mitra', role: 'mitra', pml_id: '', aktif: true });
const sumberMod = await import(pathToFileURL(path.join(root, 'functions/lib/sumber.js')).href);
const parsed = sumberMod.parseJenis(pengeringan, 'pengeringan').records.concat(sumberMod.parseJenis(penggilingan, 'penggilingan').records);
const seeded = await akunMod.ensureAkun(mem, parsed);
const arif = seeded.find(a => a.nama === 'ARIF NUROCHMAN');
if (!arif || arif.id !== '3305001') fail('ID lama bergeser: ' + JSON.stringify(arif));
const fendy = seeded.find(a => a.nama === 'FENDY HERMAWAN');
if (!fendy || fendy.id === '3305001') fail('nama baru tidak ditambahkan di akhir');
console.log('akun stabil ok');

const badLogin = await call('/api/login', { method: 'POST', json: {} });
if (badLogin.status !== 400 || badLogin.json.error.code !== 'BAD_REQUEST') fail('login kosong ' + badLogin.status);
const wrong = await call('/api/login', { method: 'POST', json: { id: '3305', password: 'salah' } });
if (wrong.status !== 401 || wrong.json.error.code !== 'INVALID_CREDENTIALS') fail('password salah ' + JSON.stringify(wrong.json));
for (let i = 0; i < 4; i++) await call('/api/login', { method: 'POST', json: { id: '3305', password: 'salah' } });
const limited = await call('/api/login', { method: 'POST', json: { id: '3305', password: 'salah' } });
if (limited.status !== 429 || !limited.headers.get('retry-after')) fail('rate limit ' + limited.status);
await kv.delete('rl:3305');

const admin = await call('/api/login', { method: 'POST', json: { id: '3305', password: '3305' } });
if (admin.status !== 200 || admin.json.user.role !== 'admin' || !admin.json.expiresAt) fail('login admin ' + JSON.stringify(admin.json));
const akun = await call('/api/admin/akun', auth(admin.json.token));
if (akun.status !== 200 || akun.json.data.some(a => a.id === '9999' || a.id === '0000')) fail('akun lama masih ada');
const mitraA = akun.json.data.find(a => a.nama === 'ARIF NUROCHMAN' && a.role === 'mitra');
const mitraB = akun.json.data.find(a => a.nama === 'FENDY HERMAWAN' && a.role === 'mitra');
const pml = akun.json.data.find(a => a.role === 'pml' && a.nama === 'TULUS YULIANTO');
if (!mitraA || !mitraB || !pml) fail('seed akun tidak lengkap');
if (akun.json.data.some(a => a.password)) fail('password bocor');

const loginA = await call('/api/login', { method: 'POST', json: { id: mitraA.id, password: mitraA.id } });
const loginB = await call('/api/login', { method: 'POST', json: { id: mitraB.id, password: mitraB.id } });
const loginP = await call('/api/login', { method: 'POST', json: { id: pml.id, password: pml.id } });
if (loginA.json.user.role !== 'mitra' || loginB.json.user.role !== 'mitra' || loginP.json.user.role !== 'pml') fail('login peran');
const meA = await call('/api/me', auth(loginA.json.token));
const meP = await call('/api/me', auth(loginP.json.token));
if (!meA.json.pml || !meA.json.pml.id) fail('mitra tanpa PML ' + JSON.stringify(meA.json));
if (typeof meA.json.stale !== 'boolean' || typeof meP.json.stale !== 'boolean') fail('me tanpa stale');
if (typeof meP.json.jumlahMitra !== 'number') fail('PML tanpa jumlahMitra');

const listA = await call('/api/sampel?jenis=pengeringan', auth(loginA.json.token));
if (!listA.json.data.length || listA.json.data.some(r => r.mitra.id !== mitraA.id)) fail('mitra melihat sampel orang lain');
const milik = listA.json.data[0];
const listB = await call('/api/sampel?jenis=pengeringan', auth(loginB.json.token));
const orangLain = listB.json.data[0];
const detailMilik = await call('/api/sampel/pengeringan/' + milik.id, auth(loginA.json.token));
if (!detailMilik.json.meta || typeof detailMilik.json.meta.stale !== 'boolean' || !detailMilik.json.meta.syncedAt) fail('detail tanpa meta');
const saring = await call('/api/sampel?jenis=pengeringan&mitra=' + encodeURIComponent(mitraA.id), auth(loginP.json.token));
if (saring.status !== 200 || !saring.json.data.length || saring.json.data.some(r => r.mitra.id !== mitraA.id)) fail('PML tidak bisa menyaring bawahan');

const inner = storeMod.createMemoryStore();
let fotoAll = 0;
let fotoOne = 0;
let fotoFail = false;
env.store = {
  kind: 'apps-script',
  listIsian: () => inner.listIsian(),
  appendIsian: (row) => inner.appendIsian(row),
  listFoto: async (jenis, id) => { fotoOne += 1; return inner.listFoto(jenis, id); },
  listFotoAll: async () => {
    fotoAll += 1;
    if (fotoFail) {
      const err = new Error('upstream');
      err.code = 'UPSTREAM_ERROR';
      throw err;
    }
    return [{
      jenis: 'pengeringan',
      id: milik.id,
      slots: [
        { slot: 'ktp', waktu: '2026-01-01T00:00:00.000Z', mime: 'image/png', oleh: mitraA.id },
        { slot: 'ktp', waktu: '2026-06-01T00:00:00.000Z', mime: 'image/jpeg', oleh: mitraA.id },
      ],
    }, {
      jenis: 'pengeringan',
      id: orangLain.id,
      slots: [{ slot: 'ktp', waktu: '2026-07-01T00:00:00.000Z', mime: 'image/png', oleh: mitraB.id }],
    }];
  },
  uploadFoto: (row) => inner.uploadFoto(row),
  getFoto: (jenis, id, slot) => inner.getFoto(jenis, id, slot),
  listAkun: () => inner.listAkun(),
  upsertAkun: (row) => inner.upsertAkun(row),
};
const batch = await call('/api/sampel?jenis=pengeringan&mitra=' + encodeURIComponent(mitraA.id), auth(loginP.json.token));
const dashBatch = await call('/api/admin/dashboard', auth(admin.json.token));
const pmlBatch = await call('/api/pml/dashboard', auth(loginP.json.token));
if (batch.status !== 200 || dashBatch.status !== 200 || pmlBatch.status !== 200) fail('batch foto ' + batch.status + '/' + dashBatch.status + '/' + pmlBatch.status);
if (fotoAll !== 1 || fotoOne !== 0) fail('masih memanggil listFoto per sampel ' + fotoAll + '/' + fotoOne);
if (batch.json.data.some(r => r.mitra.id !== mitraA.id)) fail('filter mitra sesudah agregasi');
const hit = batch.json.data.find(r => r.id === milik.id);
if (!hit || hit.fotoTerisi < 1) fail('join indeks foto kosong');
const lain = dashBatch.json.anomali.find(r => r.jenis === 'pengeringan' && r.id === orangLain.id && r.kode === 'KTP_KOSONG');
if (lain) fail('indeks foto tidak terpakai di dashboard');
const hangat = fotoAll;
await call('/api/admin/dashboard', auth(admin.json.token));
if (fotoAll !== hangat) fail('cache indeks foto tidak terpakai');
fotoFail = true;
await kv.delete('foto:ringkas:fresh');
const fotoBasi = await call('/api/sampel?jenis=pengeringan&mitra=' + encodeURIComponent(mitraA.id), auth(loginP.json.token));
if (fotoBasi.status !== 200 || fotoBasi.json.meta.stale !== true) fail('salinan terakhir indeks foto ' + fotoBasi.status);
if (fotoBasi.json.data.some(r => r.mitra.id !== mitraA.id)) fail('filter hilang saat stale');
const detailSatu = await call('/api/sampel/pengeringan/' + milik.id, auth(loginA.json.token));
if (detailSatu.status !== 200 || fotoOne !== 1) fail('detail harus tetap listFoto satu sampel');
delete env.store;
fotoFail = false;
await kv.delete('foto:ringkas:fresh');
await kv.delete('foto:ringkas:last');
console.log('batch foto ok');
const luar = await call('/api/sampel?jenis=pengeringan&mitra=' + encodeURIComponent(mitraB.id), auth(loginP.json.token));
if (luar.status !== 403 || luar.json.error.code !== 'FORBIDDEN') fail('PML menyaring mitra luar ' + luar.status);
const abaikan = await call('/api/sampel?jenis=pengeringan&mitra=' + encodeURIComponent(mitraB.id), auth(loginA.json.token));
if (abaikan.status !== 200 || abaikan.json.data.some(r => r.mitra.id !== mitraA.id)) fail('mitra tidak boleh memakai filter mitra');
const baca = await call('/api/sampel/pengeringan/' + milik.id, auth(loginB.json.token));
if (baca.status !== 403) fail('baca sampel orang lain ' + baca.status);
const tulis = await call('/api/sampel/pengeringan/' + milik.id + '/isian', {
  method: 'PUT', token: loginB.json.token,
  json: { versi: 0, kirim: false, isian: { namaResponden: 'X', statusSampel: 'Berhasil dicacah', nik: '' } },
});
if (tulis.status !== 403) fail('tulis sampel orang lain ' + tulis.status);

const opsi = await call('/api/opsi', auth(loginA.json.token));
if (!opsi.json.statusSampel.includes('Berhasil dicacah') || opsi.json.slots.length !== 12) fail('opsi');

const invalid = await call('/api/sampel/pengeringan/' + milik.id + '/isian', {
  method: 'PUT', token: loginA.json.token,
  json: { versi: 0, kirim: false, isian: { namaResponden: '', statusSampel: 'tidak-ada' } },
});
if (invalid.status !== 422 || invalid.json.error.code !== 'VALIDATION') fail('422 ' + invalid.status);

const draf = await call('/api/sampel/pengeringan/' + milik.id + '/isian', {
  method: 'PUT', token: loginA.json.token,
  json: { versi: 0, kirim: false, isian: { namaResponden: 'Siti', statusSampel: 'Berhasil dicacah', nik: '123' } },
});
if (draf.status !== 200 || draf.json.status !== 'draf' || draf.json.versi !== 1) fail('draf ' + JSON.stringify(draf.json));
const conflict = await call('/api/sampel/pengeringan/' + milik.id + '/isian', {
  method: 'PUT', token: loginA.json.token,
  json: { versi: 0, kirim: false, isian: { namaResponden: 'Siti', statusSampel: 'Berhasil dicacah' } },
});
if (conflict.status !== 409 || conflict.json.error.code !== 'CONFLICT') fail('conflict ' + conflict.status);

const fdBig = new FormData();
fdBig.append('file', new Blob([new Uint8Array(MAX_PLUS())], { type: 'image/png' }), 'big.png');
const tooBig = await call('/api/sampel/pengeringan/' + milik.id + '/foto/ktp', { method: 'PUT', token: loginA.json.token, body: fdBig });
if (tooBig.status !== 413) fail('413 ' + tooBig.status);
const fdBad = new FormData();
fdBad.append('file', new Blob([Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])], { type: 'text/plain' }), 'a.txt');
const badType = await call('/api/sampel/pengeringan/' + milik.id + '/foto/ktp', { method: 'PUT', token: loginA.json.token, body: fdBad });
if (badType.status !== 415) fail('415 ' + badType.status);
const fd = new FormData();
fd.append('file', new Blob([PNG], { type: 'image/png' }), 'a.png');
const uploaded = await call('/api/sampel/pengeringan/' + milik.id + '/foto/ktp', { method: 'PUT', token: loginA.json.token, body: fd });
if (uploaded.status !== 200 || uploaded.json.terisi !== true) fail('unggah ' + JSON.stringify(uploaded.json));
const fd2 = new FormData();
fd2.append('file', new Blob([PNG], { type: 'image/png' }), 'b.png');
await call('/api/sampel/pengeringan/' + milik.id + '/foto/ktp', { method: 'PUT', token: loginA.json.token, body: fd2 });

const kirim = await call('/api/sampel/pengeringan/' + milik.id + '/isian', {
  method: 'PUT', token: loginA.json.token,
  json: { versi: draf.json.versi, kirim: true, isian: { namaResponden: 'Siti', statusSampel: 'Berhasil dicacah', nik: '9999000000000099' } },
});
if (kirim.status !== 200 || kirim.json.status !== 'sudah' || kirim.json.locked !== true) fail('kirim ' + JSON.stringify(kirim.json));
const detailP = await call('/api/sampel/pengeringan/' + milik.id, auth(loginP.json.token));
if (detailP.status !== 200) fail('PML tidak bisa membaca bawahannya ' + detailP.status);
if (!detailP.json.isian.nik.includes('*') || detailP.json.isian.nik.includes('9999000000000099')) fail('NIK PML tidak tersamar ' + detailP.json.isian.nik);
if (detailP.json.sumber.narahubung || detailP.json.sumber.telepon) fail('narahubung bocor ke PML');
const ktpP = detailP.json.foto.find(f => f.slot === 'ktp');
if (!ktpP.hidden || ktpP.url) fail('ktp PML harus tersembunyi');
const fotoP = await call('/api/foto/pengeringan/' + milik.id + '/ktp', auth(loginP.json.token));
if (fotoP.status !== 403) fail('GET ktp PML ' + fotoP.status);
const tulisP = await call('/api/sampel/pengeringan/' + milik.id + '/isian', {
  method: 'PUT', token: loginP.json.token,
  json: { versi: kirim.json.versi, kirim: false, isian: { namaResponden: 'X', statusSampel: 'Berhasil dicacah' } },
});
if (tulisP.status !== 403) fail('PML menulis ' + tulisP.status);
const locked = await call('/api/sampel/pengeringan/' + milik.id + '/isian', {
  method: 'PUT', token: loginA.json.token,
  json: { versi: kirim.json.versi, kirim: false, isian: { namaResponden: 'Siti', statusSampel: 'Berhasil dicacah' } },
});
if (locked.status !== 409 || locked.json.error.code !== 'LOCKED') fail('locked ' + locked.status);

const koreksi = await call('/api/sampel/pengeringan/' + milik.id + '/isian', {
  method: 'PUT', token: admin.json.token,
  json: { versi: kirim.json.versi, isian: { namaResponden: 'Siti Koreksi', statusSampel: 'Berhasil dicacah', nik: '9999000000000099' } },
});
if (koreksi.status !== 200 || koreksi.json.status !== 'sudah') fail('koreksi admin ' + JSON.stringify(koreksi.json));
const tolak = await call('/api/admin/sampel/pengeringan/' + milik.id + '/tolak', {
  method: 'POST', token: admin.json.token, json: { alasan: 'NIK perlu dicek ulang' },
});
if (tolak.status !== 200 || tolak.json.status !== 'ditolak' || tolak.json.locked !== false) fail('tolak ' + JSON.stringify(tolak.json));
const lagi = await call('/api/sampel/pengeringan/' + milik.id + '/isian', {
  method: 'PUT', token: loginA.json.token,
  json: { versi: tolak.json.versi, kirim: false, isian: { namaResponden: 'Siti Lagi', statusSampel: 'Tidak Berhasil', nik: '' } },
});
if (lagi.status !== 200 || lagi.json.status !== 'draf') fail('edit setelah tolak ' + JSON.stringify(lagi.json));

const orangP = await call('/api/sampel/pengeringan/' + orangLain.id, auth(loginP.json.token));
if (orangP.status !== 403) fail('PML membaca luar bawahan ' + orangP.status);

const fotoA = await call('/api/foto/pengeringan/' + milik.id + '/ktp', auth(loginA.json.token));
if (fotoA.status !== 200 || !Buffer.from(fotoA.raw).equals(Buffer.from(PNG))) fail('unduh foto ' + fotoA.status);
if (fotoA.headers.get('cache-control') !== 'private, max-age=300') fail('cache foto');

const kosong = await call('/api/foto/pengeringan/' + milik.id + '/ka_sebelum_1', auth(loginA.json.token));
if (kosong.status !== 404) fail('slot kosong ' + kosong.status);

env.SHEET_FORCE_FAIL = true;
delete env.SHEET_CSV;
const stale = await call('/api/sampel?jenis=pengeringan', auth(admin.json.token));
if (stale.status !== 200 || stale.json.meta.stale !== true) fail('stale ' + stale.status + ' ' + JSON.stringify(stale.json && stale.json.meta));
env.SHEET_FORCE_FAIL = false;
await kv.delete('src:last:pengeringan');
await kv.delete('src:last:penggilingan');
env.SHEET_FORCE_FAIL = true;
const down = await call('/api/sampel', auth(admin.json.token));
if (down.status !== 503 || down.json.error.code !== 'SOURCE_UNAVAILABLE') fail('503 ' + down.status);
env.SHEET_FORCE_FAIL = false;
env.SHEET_CSV = { pengeringan, penggilingan };

const dash = await call('/api/admin/dashboard', auth(admin.json.token));
if (dash.status !== 200 || !dash.json.kpi.pengeringan || !Array.isArray(dash.json.anomali)) fail('dashboard');
const katalogDoc = JSON.parse(await readFile(path.join(root, 'data/monitoring-katalog.json'), 'utf8'));
const katalogAktif = katalogDoc.sheets.filter(s => !s.arsip);
const monTab = katalogAktif.find(s => s.tersedia);
const { bidang, sid: monSid, gid: monGid } = monTab;
const monCsv = 'Judul,,,\na,b,c,\n1,2,,\n,,\n';
env.GSHEET_CSV = { [monSid + ':' + monGid]: monCsv };
env.MON_TTL_S = 0;
const daftar = await call('/api/gsheets', auth(admin.json.token));
if (daftar.status !== 200 || daftar.json.sheets.length !== katalogAktif.length || daftar.json.sheets[0].bidang !== bidang || daftar.json.sheets.some(s => s.arsip)) {
  fail('gsheets admin ' + daftar.status);
}
const daftarArsip = await call('/api/gsheets?arsip=1', auth(admin.json.token));
if (daftarArsip.status !== 200 || daftarArsip.json.sheets.length !== katalogDoc.sheets.length) fail('gsheets arsip ' + daftarArsip.status);
const mon = await call('/api/gsheet?sid=' + encodeURIComponent(monSid) + '&gid=' + encodeURIComponent(monGid), auth(admin.json.token));
if (mon.status !== 200 || mon.json.meta.stale !== false || mon.json.rows.length !== 3 || mon.json.rows[1][2] !== 'c' || mon.json.headerRow !== 2) {
  fail('gsheet admin ' + JSON.stringify(mon.json));
}
const tolakMitra = await call('/api/gsheets', auth(loginA.json.token));
const tolakMitraTab = await call('/api/gsheet?sid=' + encodeURIComponent(monSid) + '&gid=' + encodeURIComponent(monGid), auth(loginA.json.token));
if (tolakMitra.status !== 403 || tolakMitraTab.status !== 403) fail('monitoring mitra ' + tolakMitra.status + '/' + tolakMitraTab.status);
const monPml = await call('/api/gsheet?sid=' + encodeURIComponent(monSid) + '&gid=' + encodeURIComponent(monGid), auth(loginP.json.token));
if (monPml.status !== 200 || monPml.json.meta.disamarkan !== true) fail('monitoring pml ' + monPml.status);
const asing = await call('/api/gsheet?sid=tidak-terdaftar&gid=0', auth(admin.json.token));
if (asing.status !== 404 || asing.json.error.code !== 'NOT_FOUND') fail('sid asing ' + asing.status);
env.GSHEET_FORCE_FAIL = true;
delete env.GSHEET_CSV;
const basi = await call('/api/gsheet?sid=' + encodeURIComponent(monSid) + '&gid=' + encodeURIComponent(monGid), auth(admin.json.token));
if (basi.status !== 200 || basi.json.meta.stale !== true || basi.json.rows[1][2] !== 'c') fail('stale monitoring ' + JSON.stringify(basi.json && basi.json.meta));
const gsheetMod = await import(pathToFileURL(path.join(root, 'functions/lib/gsheet.js')).href);
gsheetMod.lupakanCache(env);
await kv.delete('mon:v2:' + monSid + ':' + monGid);
const kosongMon = await call('/api/gsheet?sid=' + encodeURIComponent(monSid) + '&gid=' + encodeURIComponent(monGid), auth(admin.json.token));
if (kosongMon.status !== 503 || kosongMon.json.error.code !== 'SOURCE_UNAVAILABLE') fail('monitoring tanpa salinan ' + kosongMon.status);
env.GSHEET_FORCE_FAIL = false;
delete env.MON_TTL_S;
const csv = await call('/api/admin/ekspor?jenis=pengeringan&format=csv', auth(admin.json.token));
const namaFile = csv.headers.get('content-disposition') || '';
if (csv.status !== 200 || !csv.text.startsWith('\uFEFFjenis,id,') || csv.headers.get('content-type') !== 'text/csv; charset=utf-8' || !/^attachment; filename="skgb-pengeringan-\d{8}\.csv"$/.test(namaFile)) {
  fail('ekspor ' + csv.status + ' ' + namaFile + ' ' + csv.text.slice(0, 24));
}
const gudang = storeMod.createMemoryStore();
let akunCalls = 0;
let lepasAkun;
const gerbangAkun = new Promise(resolve => { lepasAkun = resolve; });
let isianGagal = false;
let lepasIsian = () => {};
let gerbangIsian = Promise.resolve();
env.store = {
  kind: 'apps-script',
  listIsian: async () => {
    await gerbangIsian;
    if (isianGagal) {
      const err = new Error('upstream');
      err.code = 'UPSTREAM_ERROR';
      throw err;
    }
    return [];
  },
  appendIsian: async (row) => row,
  listFoto: async () => [],
  listFotoAll: async () => [],
  uploadFoto: async () => ({ waktu: '' }),
  getFoto: async () => null,
  listAkun: async () => { akunCalls += 1; await gerbangAkun; return gudang.listAkun(); },
  upsertAkun: (row) => gudang.upsertAkun(row),
};
const loginHangat = await call('/api/login', { method: 'POST', json: { id: mitraA.id, password: mitraA.id } });
const meHangat = await call('/api/me', auth(loginHangat.json.token));
if (loginHangat.status !== 200 || meHangat.status !== 200 || akunCalls !== 0) fail('login/me hangat menunggu akun ' + akunCalls);
const awalDash = await call('/api/admin/dashboard', auth(admin.json.token));
if (awalDash.status !== 200 || !awalDash.json.kpi) fail('dashboard awal ' + awalDash.status);
await kv.delete('dash:admin:fresh');
gerbangIsian = new Promise(resolve => { lepasIsian = resolve; });
const pekerjaan = [];
const exec = { waitUntil(job) { pekerjaan.push(job); } };
const dashTertahan = call('/api/admin/dashboard', { token: admin.json.token, exec });
const dashCepat = await Promise.race([
  dashTertahan.then(r => ({ kind: 'res', r })),
  new Promise(resolve => setTimeout(() => resolve({ kind: 'timeout' }), 400)),
]);
if (dashCepat.kind !== 'res' || dashCepat.r.status !== 200 || dashCepat.r.json.stale !== true || dashCepat.r.json.meta.stale !== true || !dashCepat.r.json.syncedAt) {
  fail('dashboard last-good menunggu upstream');
}
lepasIsian();
await Promise.all(pekerjaan);
await dashTertahan;
await kv.delete('dash:admin:fresh');
await kv.delete('dash:admin:last');
isianGagal = true;
gerbangIsian = Promise.resolve();
const dashHilang = await call('/api/admin/dashboard', auth(admin.json.token));
if (dashHilang.status !== 502 || dashHilang.json.error.code !== 'UPSTREAM_ERROR') fail('dashboard tanpa salinan ' + dashHilang.status);
isianGagal = false;
await kv.delete('akun:fresh');
const loginTertahan = call('/api/login', { method: 'POST', json: { id: mitraA.id, password: mitraA.id } });
const loginCepat = await Promise.race([
  loginTertahan.then(r => ({ kind: 'res', r })),
  new Promise(resolve => setTimeout(() => resolve({ kind: 'timeout' }), 400)),
]);
if (loginCepat.kind !== 'res' || loginCepat.r.status !== 200) fail('login last-good menunggu Apps Script');
const meBasi = await call('/api/me', auth(loginCepat.r.json.token));
if (meBasi.status !== 200 || meBasi.json.stale !== true || !meBasi.json.meta || meBasi.json.meta.stale !== true || !meBasi.json.syncedAt) {
  fail('me basi ' + JSON.stringify(meBasi.json));
}
const sebelumAsing = akunCalls;
const idSalah = await call('/api/login', { method: 'POST', json: { id: '9999', password: '9999' } });
const bentukSalah = await call('/api/login', { method: 'POST', json: { id: '3305P1', password: '3305P1' } });
if (idSalah.status !== 401 || idSalah.json.error.code !== 'INVALID_CREDENTIALS' || bentukSalah.status !== 401 || akunCalls !== sebelumAsing) {
  fail('ID tidak valid memanggil Apps Script ' + idSalah.status + ' ' + akunCalls);
}
const terakhir = JSON.parse(await kv.get('akun:last'));
terakhir.akun = terakhir.akun.filter(a => a.id !== mitraA.id);
await kv.put('akun:last', JSON.stringify(terakhir));
await kv.delete('akun:fresh');
const loginBaru = call('/api/login', { method: 'POST', json: { id: mitraA.id, password: mitraA.id } });
const loginMenunggu = await Promise.race([
  loginBaru.then(r => ({ kind: 'res', r })),
  new Promise(resolve => setTimeout(() => resolve({ kind: 'timeout' }), 400)),
]);
if (loginMenunggu.kind !== 'timeout') fail('login ID di luar last-good tidak menyinkronkan');
const saatSync = akunCalls;
const kedua = await call('/api/login', { method: 'POST', json: { id: '3305999', password: '3305999' } });
if (kedua.status !== 401 || kedua.json.error.code !== 'INVALID_CREDENTIALS' || akunCalls !== saatSync) {
  fail('sync ID tak dikenal terulang ' + kedua.status + ' ' + akunCalls);
}
lepasAkun();
const loginSelesai = await loginBaru;
if (loginSelesai.status !== 200 || loginSelesai.json.user.id !== mitraA.id) fail('sync satu kali ' + loginSelesai.status);
await loginTertahan;
delete env.store;
await kv.delete('dash:admin:fresh');
await kv.delete('dash:admin:last');
console.log('login cache ok');

const bye = await call('/api/logout', { method: 'POST', token: loginA.json.token });
const bye2 = await call('/api/logout', { method: 'POST' });
if (bye.status !== 200 || bye2.status !== 200 || bye.json.ok !== true) fail('logout');
const dead = await call('/api/me', auth(loginA.json.token));
if (dead.status !== 401) fail('sesi masih hidup');
const lama = await call('/api/realisasi', auth(admin.json.token));
if (lama.status !== 404) fail('endpoint lama ' + lama.status);

console.log('kontrak ok');

function MAX_PLUS() { return 2 * 1024 * 1024 + 1; }
