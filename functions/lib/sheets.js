import { json, readJson } from './http.js';
import { applyCell, derive } from './rows.js';
import { kabFilter } from './scope.js';

export const HEADERS = {
  panen: ['ID SUBSEGMEN', 'KDKAB', 'JENIS SAMPEL', 'BULAN APRIL', 'AMATAN MEI', 'AMATAN JUNI', 'SAMPEL PENGGANTI', 'NAMA PENGELOLA UTP', 'NO HP', 'STATUS ELIGIBLE'],
  panen33: ['KABUPATEN/KOTA', 'NAMA PETUGAS', 'JENIS SAMPEL', 'ID SAMPEL', 'HASIL IDENTIFIKASI TITIK AMATAN SUBSEGMEN', 'APAKAH ADA PETAK LAIN DALAM SUBSEGMEN TERPILIH YANG AKAN PANEN?', 'PERKIRAAN PANEN', 'JENIS PEMANENAN', 'APAKAH HASIL PANEN BISA LEBIH DARI 200 KG DI PETAK TERSEBUT?', 'NO HP PETANI/PENEBAS', 'LOKASI SAWAH', 'CATATAN', 'TIMESTAMP'],
  utker: ['KDKAB', 'IDSUBSEGMEN', 'STATUS ELIGIBLE', 'STATUS PROBABLE', 'SAMPEL PENGGANTI'],
  utgil: ['KDKAB', 'IDSUBSEGMEN', 'JENIS SAMPEL', 'STATUS ELIGIBLE', 'SAMPEL PENGGANTI'],
  'ksa-mei': ['ID SEGMEN', 'SUBSEGMEN', 'ID_SUBSEGMEN', 'NAMA', 'FEB', 'MAR', 'APRIL', 'MEI', 'APAKAH DI SEKITAR TITIK AMATAN SUBSEGMEN TERSEBUT ADA PETAK LAIN YANG AKAN ATAU SIAP PANEN (V2, G1, G2 DAN G3)'],
  'ksa-juni': ['ID SEGMEN', 'SUBSEGMEN', 'ID_SUBSEGMEN', 'NAMA', 'FEB', 'MAR', 'APRIL', 'MEI', 'JUNI', 'APAKAH DI SEKITAR TITIK AMATAN SUBSEGMEN TERSEBUT ADA PETAK LAIN YANG AKAN ATAU SIAP PANEN (V2, G1, G2 DAN G3)'],
  kering1: ['KABUPATEN/KOTA', 'NAMA PETUGAS SKGB', 'JENIS SAMPEL', 'ID SUBSEGMEN', '207. HASIL PENCACAHAN', 'TANGGAL KUNJUNGAN PERTAMA (SAAT PANEN)', 'LOKASI (PANEN)', '305.A. BERAT WADAH (PANEN)', '305.B. BERAT GABAH DAN WADAH (PANEN)', '305.C. RATA-RATA KADAR AIR (PANEN)'],
  kering2: ['KABUPATEN/KOTA', 'NAMA PETUGAS SKGB', 'JENIS SAMPEL', 'ID SUBSEGMEN', '207. HASIL PENCACAHAN', 'TANGGAL KUNJUNGAN KEDUA SAAT (PENGERINGAN)', '400. LOKASI (PENGERINGAN)', '401.A. BERAT WADAH', '401.B. BERAT GABAH DAN WADAH', '401.C. RATA-RATA KADAR AIR'],
  direktori: ['KABUPATEN/KOTA', 'JENIS', 'NAMA PENGGILINGAN', 'TELEPON', 'SKALA'],
  penggantigiling: ['KAB', 'PENGGILINGAN UTAMA', 'SAMPEL PENGGANTI', 'TIMESTAMP'],
  giling: ['KABUPATEN/KOTA', 'NAMA PETUGAS SKGB GILING', 'JENIS SAMPEL', 'NAMA PENGGILINGAN', 'SKALA', 'TANGGAL PENDATAAN', 'LOKASI PENGGILINGAN', '115. HASIL PENCACAHAN', '401.A. BERAT WADAH (GKG)', '401.B. BERAT GABAH (GKG) + WADAH', '401.C. RATA-RATA KADAR AIR (GKG)', '403.A. BERAT WADAH (BERAS)', '403.B. BERAT BERAS + WADAH', '403.C. RATA-RATA KADAR AIR BERAS'],
};

const KNOWN = new Set(Object.keys(HEADERS));

export function buildSubmit(name, row, me) {
  const kab = me.role === 'kab' ? me.kode : (row.kab || me.kode);
  if (name === 'panen33') {
    return { kab, petugas: row.petugas, jenis: row.jenis, id: row.id, hasil: row.hasil, petak: row.petak || '', perk: row.perk || '', pemanen: row.pemanen || '', hp2: row.hp2 || '', lok: row.lok || '', cat: row.cat || '', ts: new Date().toISOString() };
  }
  if (name === 'kering1' || name === 'kering2') {
    return { kab, petugas: row.petugas, jenis: row.jenis, id: row.id, hasil: row.hasil, tgl1: row.tgl1 || '', lok1: row.lok1 || '', w305a: row.w305a || '', w305b: row.w305b || '', w305c: row.w305c || '' };
  }
  if (name === 'giling') {
    return { kab, petugas: row.petugas, jenis: row.jenis, peng: row.peng, skala: row.skala, tgl: row.tgl, lok: row.lok || '', hasil: row.hasil, gA: row.gA || '', gB: row.gB || '', gC: row.gC || '', bA: row.bA || '', bB: row.bB || '', bC: row.bC || '' };
  }
  if (name === 'penggantigiling') {
    return { kab, pengUtama: row.pengUtama, pengganti: row.pengganti, ts: new Date().toISOString() };
  }
  return null;
}

async function insertRow(env, sheet, obj) {
  const d = derive(obj);
  await env.DB.prepare(
    `INSERT INTO sheet_row (sheet, kab, row_key, jenis, status, cadangan, hasil, petak, pemanen, data)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(sheet, d.kab, d.rowKey, d.jenis, d.status, d.cadangan, d.hasil, d.petak, d.pemanen, JSON.stringify(obj)).run();
}

export async function getSheet(request, env, me, name) {
  if (!KNOWN.has(name)) return json(404, { error: 'Sheet not found' });
  const url = new URL(request.url);
  const effKab = kabFilter(me, url.searchParams.get('kab'), { lockOwn: true });
  const stmt = effKab
    ? env.DB.prepare('SELECT data FROM sheet_row WHERE sheet = ?1 AND kab = ?2 ORDER BY id').bind(name, effKab)
    : env.DB.prepare('SELECT data FROM sheet_row WHERE sheet = ?1 ORDER BY id').bind(name);
  const { results } = await stmt.all();
  const parts = results.map(r => typeof r.data === 'string' ? r.data : JSON.stringify(r.data));
  const header = HEADERS[name];
  const body = '{"header":' + JSON.stringify(header) + ',"data":[' + parts.join(',') + ']}';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function postSheet(request, env, me, name) {
  if (!KNOWN.has(name)) return json(404, { error: 'Sheet not found' });
  const body = await readJson(request);
  if (body.action === 'submit') {
    const obj = buildSubmit(name, body.data || {}, me);
    if (!obj) return json(400, { error: 'Submit tidak didukung ke sheet ini' });
    await insertRow(env, name, obj);
    return json(200, { success: true });
  }
  if (body.action === 'updateCell') {
    const key = body.matchValue;
    const found = await env.DB.prepare(
      'SELECT id, kab, data FROM sheet_row WHERE sheet = ?1 AND row_key = ?2 ORDER BY id LIMIT 1'
    ).bind(name, String(key ?? '')).first();
    if (!found) return json(404, { success: false, message: 'Row not found' });
    if (me.role === 'kab' && found.kab !== me.kode) return json(403, { error: 'Akses kabupaten lain ditolak' });
    let hit;
    try { hit = typeof found.data === 'string' ? JSON.parse(found.data) : found.data; }
    catch { return json(500, { error: 'Baris rusak' }); }
    if (!applyCell(hit, body.targetColumn, body.value)) return json(400, { success: false, message: 'Column not found' });
    const d = derive(hit);
    if (me.role === 'kab' && d.kab !== me.kode) return json(403, { error: 'Akses kabupaten lain ditolak' });
    await env.DB.prepare(
      `UPDATE sheet_row SET kab=?1, row_key=?2, jenis=?3, status=?4, cadangan=?5, hasil=?6, petak=?7, pemanen=?8, data=?9 WHERE id=?10`
    ).bind(d.kab, d.rowKey, d.jenis, d.status, d.cadangan, d.hasil, d.petak, d.pemanen, JSON.stringify(hit), found.id).run();
    return json(200, { success: true });
  }
  return json(400, { error: 'Unknown action' });
}
