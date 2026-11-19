// Ubah data/db.json menjadi SQL untuk `wrangler d1 execute --file`.
// Nilai teks dikodekan heksadesimal agar tanda kutip di data tidak memecah pernyataan.
import { readFile } from 'node:fs/promises';
import { derive } from '../functions/lib/rows.js';

const file = process.argv[2];
if (!file) {
  console.error('Pakai: node scripts/import-db-sql.mjs data/db.json');
  process.exit(1);
}

const SHEET = {
  panen: 'panen',
  panen33: 'panen33',
  utker: 'utker',
  utgil: 'utgil',
  ksaMei: 'ksa-mei',
  ksaJuni: 'ksa-juni',
  kering1: 'kering1',
  direktori: 'direktori',
  penggantiGiling: 'penggantigiling',
  gilingInput: 'giling',
};

function sqlText(value) {
  return "CAST(X'" + Buffer.from(String(value), 'utf8').toString('hex') + "' AS TEXT)";
}

function sqlInt(value, nullable) {
  if (value == null || value === '') return nullable ? 'NULL' : '0';
  const n = Number(value);
  if (!Number.isFinite(n)) return nullable ? 'NULL' : '0';
  return String(Math.trunc(n));
}

const db = JSON.parse(await readFile(file, 'utf8'));
const out = [];
out.push('DELETE FROM sheet_row;');
out.push('DELETE FROM target;');
out.push('DELETE FROM users;');

const userRows = Object.entries(db.users || {}).map(([kode, u]) =>
  '(' + [sqlText(kode), sqlText(u.p == null ? kode : u.p), sqlText(u.nama || kode), sqlText(u.role || 'kab')].join(',') + ')'
);
for (let i = 0; i < userRows.length; i += 40) {
  out.push('INSERT INTO users (kode, password, nama, role) VALUES\n' + userRows.slice(i, i + 40).join(',\n') + ';');
}

const targetRows = [];
for (const jenis of ['kering', 'kering2', 'giling']) {
  const bag = (db.target && db.target[jenis]) || {};
  for (const kode of Object.keys(bag)) {
    const cell = bag[kode] || {};
    targetRows.push('(' + [sqlText(kode), sqlText(jenis), sqlInt(cell.t), sqlInt(cell.r)].join(',') + ')');
  }
}
for (let i = 0; i < targetRows.length; i += 40) {
  out.push('INSERT INTO target (kode, jenis, t, r) VALUES\n' + targetRows.slice(i, i + 40).join(',\n') + ';');
}

for (const [src, sheet] of Object.entries(SHEET)) {
  const rows = Array.isArray(db[src]) ? db[src] : [];
  const values = rows.map(row => {
    const d = derive(row);
    return '(' + [
      sqlText(sheet), sqlText(d.kab), sqlText(d.rowKey), sqlText(d.jenis), sqlText(d.status),
      sqlInt(d.cadangan, true), sqlText(d.hasil), sqlText(d.petak), sqlText(d.pemanen), sqlText(JSON.stringify(row)),
    ].join(',') + ')';
  });
  for (let i = 0; i < values.length; i += 40) {
    out.push(
      'INSERT INTO sheet_row (sheet, kab, row_key, jenis, status, cadangan, hasil, petak, pemanen, data) VALUES\n'
      + values.slice(i, i + 40).join(',\n') + ';'
    );
  }
}

process.stdout.write(out.join('\n') + '\n');
