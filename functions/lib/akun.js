import { canonNama } from './sumber.js';

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
