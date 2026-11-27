// Kunci baris stabil untuk koreksi monitoring. Dihitung dari data mentah
// (sebelum disamarkan) agar admin dan PML mendapat nilai yang sama.
import { terisi } from './gsheet.js';
import { normHeader } from './ringkasan.js';

function hashPendek(row) {
  const s = JSON.stringify((row || []).map(v => String(v ?? '')));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function potong(k, maks) {
  return k.length <= maks ? k : k.slice(0, maks);
}

// tab.ringkasan.kunci (bila ada dan kolomnya ketemu) jadi sumber resmi.
// Selain itu, atau bila sel kunci kosong: "r{n}:{hash8}" (n 1-based di rows).
// Nilai kunci yang dobel di tab yang sama: kemunculan berikutnya mendapat akhiran "#r{n}".
export function buatKunciBaris(tab, rows, headerRow) {
  const n = Array.isArray(rows) ? rows.length : 0;
  const kunciBaris = Array(n).fill(null);
  const header = headerRow > 0 ? (rows[headerRow - 1] || []) : [];
  const namaKolom = tab && tab.ringkasan && tab.ringkasan.kunci ? String(tab.ringkasan.kunci) : null;
  const indeks = namaKolom ? header.findIndex(h => normHeader(h) === normHeader(namaKolom)) : -1;
  const sumber = indeks >= 0 ? 'pemetaan' : 'baris+hash';
  const seen = new Set();
  const mulai = headerRow > 0 ? headerRow : 0;
  for (let i = mulai; i < n; i++) {
    const row = rows[i];
    if (!row || !row.some(v => String(v ?? '').trim() !== '')) continue;
    let k = null;
    if (indeks >= 0 && terisi(row[indeks])) k = potong(String(row[indeks]).trim(), 120);
    if (!k) k = 'r' + (i + 1) + ':' + hashPendek(row);
    else if (seen.has(k)) {
      const suf = '#r' + (i + 1);
      k = potong(k, 120 - suf.length) + suf;
    }
    seen.add(k);
    kunciBaris[i] = k;
  }
  return {
    kunci: {
      kolom: indeks >= 0 ? namaKolom : null,
      indeks: indeks >= 0 ? indeks : null,
      sumber,
    },
    kunciBaris,
  };
}
