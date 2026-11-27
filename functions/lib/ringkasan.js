// B7: ringkasan progres khusus Tanaman Pangan (K4).
// Pemetaan kolom EKSPLISIT per tab ada di data/monitoring-katalog.json (field `ringkasan`).
// Definisi "sudah" sengaja konservatif:
//   aturan 'sama'   -> nilai kolom status (dinormalisasi) persis salah satu `nilai`.
//   aturan 'terisi' -> kolom status tidak kosong dan bukan penanda galat (-, #N/A, #REF!, ...).
// Baris dihitung hanya bila kolom kunci terisi.
import { terisi } from './gsheet.js';

export function normHeader(h) {
  return String(h ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function indeksKolom(header, nama) {
  if (nama == null) return -1;
  const want = normHeader(nama);
  return header.findIndex(h => normHeader(h) === want);
}

export function definisiTeks(map) {
  const s = map.sudah;
  if (s.aturan === 'sama') return `Sudah bila kolom "${s.kolom}" bernilai ${s.nilai.map(v => `"${v}"`).join(' atau ')} (tanpa beda huruf besar/kecil).`;
  return `Sudah bila kolom "${s.kolom}" terisi (bukan kosong, "-", atau penanda galat seperti #N/A).`;
}

function kelompok(baris, iKol, iSudah) {
  const m = new Map();
  for (const { r, sudah } of baris) {
    const k = iKol < 0 ? '' : String(r[iKol] ?? '').trim();
    const nama = k || '(kosong)';
    const g = m.get(nama) || { nama, total: 0, sudah: 0 };
    g.total++;
    if (sudah) g.sudah++;
    m.set(nama, g);
  }
  return [...m.values()]
    .map(g => ({ ...g, belum: g.total - g.sudah, persen: persen(g.sudah, g.total) }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}

function persen(a, b) {
  return b ? Math.round((a / b) * 1000) / 10 : 0;
}

// rows: matriks mentah; headerRow: 1-based.
export function hitungRingkasan(map, rows, headerRow) {
  const header = rows[headerRow - 1] || [];
  const iKunci = indeksKolom(header, map.kunci);
  const iStatus = indeksKolom(header, map.sudah.kolom);
  const iPml = indeksKolom(header, map.pml);
  const iPcl = indeksKolom(header, map.pcl);
  const iKec = indeksKolom(header, map.kecamatan);
  const hilang = [];
  if (iKunci < 0) hilang.push(map.kunci);
  if (iStatus < 0) hilang.push(map.sudah.kolom);
  if (map.pml && iPml < 0) hilang.push(map.pml);
  if (map.pcl && iPcl < 0) hilang.push(map.pcl);
  if (map.kecamatan && iKec < 0) hilang.push(map.kecamatan);
  if (hilang.length) return { ok: false, code: 'RINGKASAN_KOLOM_HILANG', kolom: hilang };
  const nilaiSudah = new Set((map.sudah.nilai || []).map(normHeader));
  const baris = [];
  for (const r of rows.slice(headerRow)) {
    if (!terisi(r[iKunci])) continue;
    const v = r[iStatus];
    const sudah = map.sudah.aturan === 'sama' ? nilaiSudah.has(normHeader(v)) : terisi(v);
    baris.push({ r, sudah });
  }
  const total = baris.length;
  const sudah = baris.filter(b => b.sudah).length;
  const rincianMap = new Map();
  for (const { r } of baris) {
    const v = String(r[iStatus] ?? '').replace(/\s+/g, ' ').trim() || '(kosong)';
    rincianMap.set(v, (rincianMap.get(v) || 0) + 1);
  }
  const rincian = [...rincianMap.entries()].map(([nilai, jumlah]) => ({ nilai, jumlah })).sort((a, b) => b.jumlah - a.jumlah || a.nilai.localeCompare(b.nilai, 'id'));
  return {
    ok: true,
    total,
    sudah,
    belum: total - sudah,
    persen: persen(sudah, total),
    definisi: {
      teks: definisiTeks(map),
      kolomKunci: map.kunci,
      kolomStatus: map.sudah.kolom,
      aturan: map.sudah.aturan,
      nilai: map.sudah.nilai || null,
      catatan: map.catatan || '',
      ragu: Boolean(map.ragu),
    },
    rincian,
    perPml: map.pml ? kelompok(baris, iPml).map(({ nama, ...g }) => ({ pml: nama, ...g })) : null,
    perPcl: map.pcl ? kelompok(baris, iPcl).map(({ nama, ...g }) => ({ pcl: nama, ...g })) : null,
    perKecamatan: map.kecamatan ? kelompok(baris, iKec).map(({ nama, ...g }) => ({ kecamatan: nama, ...g })) : null,
  };
}
