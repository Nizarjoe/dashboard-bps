// Sinkron katalog monitoring dengan Google Sites "Monitoring Produksi 3305".
//
// Pakai:
//   node scripts/sync-katalog.mjs                 laporan beda saja (tidak menulis)
//   node scripts/sync-katalog.mjs --probe         plus cek akses CSV tiap tab dan status tautan
//   node scripts/sync-katalog.mjs --tulis         tambahkan tab baru sebagai draf, perbarui tautan
//   node scripts/sync-katalog.mjs --dari <folder> baca HTML lokal (<slug>.html), tanpa jaringan
//   node scripts/sync-katalog.mjs --ketat         keluar dengan kode 1 bila ada beda
//
// Hanya membaca situs dan ekspor CSV publik. Tidak pernah menulis ke sheet.
// Kolom kurasi (survei, periode, jenis, tersedia, alasan, ringkasan, samaran) tidak disentuh.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HALAMAN, SITUS, parseHalaman, bandingkan, entriDraf, kunci } from './lib/katalog-sites.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(root, 'data', 'monitoring-katalog.json');
const args = process.argv.slice(2);
const opt = {
  probe: args.includes('--probe'),
  tulis: args.includes('--tulis'),
  ketat: args.includes('--ketat'),
  dari: args.includes('--dari') ? args[args.indexOf('--dari') + 1] : null,
  katalog: args.includes('--katalog') ? args[args.indexOf('--katalog') + 1] : FILE,
};
const UA = { 'user-agent': 'Mozilla/5.0 (sinkron katalog SINTA PADI)' };

async function ambil(slug) {
  if (opt.dari) return readFile(path.join(opt.dari, slug + '.html'), 'utf8');
  const res = await fetch(SITUS + '/' + slug, { headers: UA });
  if (!res.ok) throw new Error(slug + ': HTTP ' + res.status);
  return res.text();
}

async function cekSheet(sid, gid) {
  const url = 'https://docs.google.com/spreadsheets/d/' + sid + '/export?format=csv&gid=' + gid;
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    const ct = res.headers.get('content-type') || '';
    await res.body?.cancel();
    if (res.ok && ct.includes('text/csv')) return { status: res.status, kode: null };
    if (res.ok) return { status: res.status, kode: 'SHEET_NOT_PUBLIC' };
    if (res.status === 400) return { status: 400, kode: 'SHEET_FORMAT_UNSUPPORTED' };
    if (res.status === 404 || res.status === 410) return { status: res.status, kode: 'SHEET_REMOVED' };
    if (res.status === 401 || res.status === 403) return { status: res.status, kode: 'SHEET_NOT_PUBLIC' };
    return { status: res.status, kode: 'SOURCE_UNAVAILABLE' };
  } catch (e) {
    return { status: 'ERR', kode: 'SOURCE_UNAVAILABLE' };
  }
}

async function cekTautan(url) {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    await res.body?.cancel();
    return res.status;
  } catch { return 'ERR'; }
}

const doc = JSON.parse(await readFile(opt.katalog, 'utf8'));
const katalog = doc.sheets;
const situs = [];
for (const h of HALAMAN) {
  const html = await ambil(h.slug);
  for (const s of parseHalaman(html, h.slug)) situs.push({ ...s, bidang: h.bidang });
}
const unik = new Map();
for (const s of situs) if (!unik.has(kunci(s))) unik.set(kunci(s), s);
const beda = bandingkan(katalog, [...unik.values()]);

console.log(`situs: ${unik.size} tab unik dari ${HALAMAN.length} halaman; katalog: ${katalog.length} tab`);
console.log(`baru di situs: ${beda.baru.length}`);
for (const s of beda.baru) console.log(`  + ${s.bidang} ${s.sid}:${s.gid} ${s.label}`);
console.log(`hilang dari situs: ${beda.hilang.length}`);
for (const x of beda.hilang) console.log(`  - ${x.id} ${x.label}`);
console.log(`tautan berubah: ${beda.tautanBerubah.length}`);
for (const t of beda.tautanBerubah) console.log(`  ~ ${t.id} ${t.sebelum} -> ${t.sesudah}`);

if (opt.probe) {
  console.log('cek akses CSV:');
  for (const x of katalog) {
    const r = await cekSheet(x.sid, x.gid);
    const cocok = x.tersedia === false ? (x.alasan && x.alasan.kode === r.kode) : r.kode == null;
    console.log(`  ${cocok ? 'ok ' : 'BEDA'} ${x.id} http ${r.status}${r.kode ? ' ' + r.kode : ''}${x.tersedia === false ? ' (katalog: dilewati ' + x.alasan.kode + ')' : ''}`);
  }
  console.log('cek tautan form/drive:');
  const sudah = new Set();
  for (const x of katalog) for (const t of x.tautan || []) {
    if (sudah.has(t.url)) continue;
    sudah.add(t.url);
    const st = await cekTautan(t.url);
    const buruk = st === 404 || st === 410 || st === 'ERR' || (typeof st === 'number' && st >= 500);
    if (buruk !== Boolean(t.perluCek)) console.log(`  BEDA http ${st} perluCek=${Boolean(t.perluCek)} ${t.url}`);
  }
}

if (opt.tulis) {
  const bySitus = new Map([...unik.values()].map(s => [kunci(s), s]));
  for (const x of katalog) {
    const s = bySitus.get(kunci(x));
    x.diSitus = Boolean(s);
    if (s && !x.tautanManual) {
      const lama = new Map((x.tautan || []).map(t => [t.url, t]));
      x.tautan = s.tautan.map(t => ({ ...t, ...(lama.get(t.url)?.perluCek ? { perluCek: true } : {}) }));
    }
  }
  for (const s of beda.baru) katalog.push(entriDraf(s, s.bidang));
  doc.diperbarui = new Date().toISOString().slice(0, 10);
  await writeFile(opt.katalog, JSON.stringify(doc, null, 2) + '\n');
  console.log('katalog ditulis: ' + path.relative(root, opt.katalog));
}

if (opt.ketat && (beda.baru.length || beda.hilang.length || beda.tautanBerubah.length)) process.exit(1);
