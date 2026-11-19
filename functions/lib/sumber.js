import { apiError } from './errors.js';

export const SHEET_IDS = {
  pengeringan: '1GlyJLe84fw2yRpZ4li46URdumwXpPLCM',
  penggilingan: '1xGc6KE53mbz0U-UaP82W8kNVT9n4aQxO',
};

const FRESH_TTL = 180;

export const SLOTS = [
  ['ka_sebelum_1', 'Foto Kadar Air Sebelum Pengeringan Amatan ke 1', 'Foto Kadar Air Sebelum Penggilingan Amatan ke 1'],
  ['ka_sebelum_2', 'Foto Kadar Air Sebelum Pengeringan Amatan ke 2', 'Foto Kadar Air Sebelum Penggilingan Amatan ke 2'],
  ['ka_sebelum_3', 'Foto Kadar Air Sebelum Pengeringan Amatan ke 3', 'Foto Kadar Air Sebelum Penggilingan Amatan ke 3'],
  ['ka_sebelum_4', 'Foto Kadar Air Sebelum Pengeringan Amatan ke 4', 'Foto Kadar Air Sebelum Penggilingan Amatan ke 4'],
  ['ka_sebelum_5', 'Foto Kadar Air Sebelum Pengeringan Amatan ke 5', 'Foto Kadar Air Sebelum Penggilingan Amatan ke 5'],
  ['ka_setelah_1', 'Foto Kadar Air Setelah Pengeringan Amatan ke 1', 'Foto Kadar Air Setelah Penggilingan Amatan ke 1'],
  ['ka_setelah_2', 'Foto Kadar Air Setelah Pengeringan Amatan ke 2', 'Foto Kadar Air Setelah Penggilingan Amatan ke 2'],
  ['ka_setelah_3', 'Foto Kadar Air Setelah Pengeringan Amatan ke 3', 'Foto Kadar Air Setelah Penggilingan Amatan ke 3'],
  ['ka_setelah_4', 'Foto Kadar Air Setelah Pengeringan Amatan ke 4', 'Foto Kadar Air Setelah Penggilingan Amatan ke 4'],
  ['ka_setelah_5', 'Foto Kadar Air Setelah Pengeringan Amatan ke 5', 'Foto Kadar Air Setelah Penggilingan Amatan ke 5'],
  ['ktp', 'Foto KTP Responden', 'Foto KTP Responden'],
  ['penyerahan', 'Foto Penyerahan Biaya Penggantian Sampel', 'Foto Penyerahan Biaya Penggantian Sampel'],
];

export const HASIL_TETAP = [
  '1. Berhasil diwawancarai',
  '2. Tidak bersedia diwawancarai',
  '3. Tidak dapat diwawancarai sampai batas akhir pencacahan',
  '4. Belum panen sampai batas waktu pendataan',
  '5. Lewat panen',
  '6. Gagal panen',
  '7. Tidak diwawancarai dengan alasan lainnya',
];

export const STATUS_TETAP = ['Berhasil dicacah', 'Tidak Berhasil'];

export function canonNama(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function normHeader(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
}

export function parseCsv(csv) {
  const text = String(csv || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inq = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inq) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inq = false;
      else cell += ch;
    } else if (ch === '"') inq = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') continue;
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function col(header, ...aliases) {
  const want = aliases.map(normHeader);
  return header.findIndex(h => want.includes(normHeader(h)));
}

function cell(row, index) {
  if (index < 0) return '';
  return row[index] == null ? '' : String(row[index]).trim();
}

function flagOf(value) {
  const s = String(value || '').trim().toUpperCase();
  if (s.startsWith('C')) return 'C';
  if (s.startsWith('U')) return 'U';
  return s === 'CADANGAN' ? 'C' : 'U';
}

export function parseJenis(csv, jenis) {
  const rows = parseCsv(csv);
  const header = rows[2] || [];
  const fotoIndex = {};
  for (const [slot, labK, labG] of SLOTS) fotoIndex[slot] = col(header, jenis === 'pengeringan' ? labK : labG);
  const ix = jenis === 'pengeringan'
    ? {
      id: col(header, 'idsubsegmen'),
      kdkec: col(header, 'kdkec'),
      nmkec: col(header, 'nmkec'),
      desa: col(header, 'lokasi'),
      nks: col(header, 'nks'),
      fase: col(header, 'fase_ amatan', 'fase_amatan'),
      x: col(header, 'x'),
      y: col(header, 'y'),
      bulan: col(header, 'bulan_panen'),
      flag: col(header, 'flag_ sampel', 'flag_sampel'),
      pcl: col(header, 'pcl'),
      pml: col(header, 'pml'),
      lokasi: col(header, 'lokasi idsegmen'),
      status: col(header, 'status sampel'),
      responden: col(header, 'nama responden'),
      nik: col(header, 'nik'),
    }
    : {
      id: col(header, 'id sbr'),
      kdkec: col(header, 'kode kecamatan'),
      nmkec: col(header, 'nama kecamatan'),
      desa: col(header, 'nama desa/ kelurahan', 'nama desa/kelurahan'),
      nama: col(header, 'nama usaha/perusahaan'),
      nks: col(header, 'nks'),
      x: col(header, 'longitude'),
      y: col(header, 'latitude'),
      flag: col(header, 'jenis sampel'),
      pcl: col(header, 'pcl'),
      pml: col(header, 'pml'),
      skala: col(header, 'skala usaha/perusahaan'),
      narahubung: col(header, 'nama narahubung'),
      telepon: col(header, 'nomor telepon'),
      alamat: col(header, 'alamat usaha'),
      hasil: col(header, 'hasil pencacahan'),
      responden: col(header, 'nama responden'),
      nik: col(header, 'nik'),
    };
  const out = [];
  for (const raw of rows.slice(3)) {
    if (!raw.some(v => String(v || '').trim())) continue;
    const id = cell(raw, ix.id);
    if (!id) continue;
    const fotoSheet = {};
    for (const [slot] of SLOTS) fotoSheet[slot] = cell(raw, fotoIndex[slot]);
    out.push({
      jenis,
      id,
      kdkec: cell(raw, ix.kdkec),
      nmkec: cell(raw, ix.nmkec),
      desa: cell(raw, ix.desa),
      nama: jenis === 'penggilingan' ? cell(raw, ix.nama) : null,
      nks: cell(raw, ix.nks),
      flagSampel: flagOf(cell(raw, ix.flag)),
      pcl: canonNama(cell(raw, ix.pcl)),
      pml: canonNama(cell(raw, ix.pml)),
      sumber: {
        faseAmatan: cell(raw, ix.fase) || null,
        bulanPanen: cell(raw, ix.bulan) || null,
        x: cell(raw, ix.x) || null,
        y: cell(raw, ix.y) || null,
        lokasiIdSegmen: cell(raw, ix.lokasi) || null,
        skalaUsaha: cell(raw, ix.skala) || null,
        narahubung: cell(raw, ix.narahubung) || null,
        telepon: cell(raw, ix.telepon) || null,
        alamat: cell(raw, ix.alamat) || null,
      },
      bawaan: {
        namaResponden: cell(raw, ix.responden),
        nik: cell(raw, ix.nik),
        statusSampel: jenis === 'pengeringan' ? cell(raw, ix.status) : null,
        hasilPencacahan: jenis === 'penggilingan' ? cell(raw, ix.hasil) : null,
      },
      fotoSheet,
      raw: raw,
      header,
    });
  }
  return { header, records: out };
}

async function readKind(env, jenis) {
  const id = SHEET_IDS[jenis];
  const freshKey = 'src:fresh:' + jenis;
  const lastKey = 'src:last:' + jenis;
  const kv = env && env.SESSIONS;
  if (env && env.SHEET_FORCE_FAIL) {
    const last = kv ? await kv.get(lastKey) : null;
    if (!last) return null;
    const saved = JSON.parse(last);
    return { csv: saved.csv, syncedAt: saved.syncedAt, stale: true };
  }
  const inline = env && env.SHEET_CSV && env.SHEET_CSV[jenis];
  if (inline) {
    const syncedAt = new Date().toISOString();
    if (kv) await kv.put(lastKey, JSON.stringify({ csv: inline, syncedAt }));
    return { csv: inline, syncedAt, stale: false };
  }
  if (kv) {
    const fresh = await kv.get(freshKey);
    if (fresh) {
      const saved = JSON.parse(fresh);
      return { csv: saved.csv, syncedAt: saved.syncedAt, stale: false };
    }
  }
  const url = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=csv';
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('status ' + res.status);
    const csv = await res.text();
    const syncedAt = new Date().toISOString();
    const packed = JSON.stringify({ csv, syncedAt });
    if (kv) {
      await kv.put(lastKey, packed);
      await kv.put(freshKey, packed, { expirationTtl: FRESH_TTL });
    }
    return { csv, syncedAt, stale: false };
  } catch {
    if (!kv) return null;
    const last = await kv.get(lastKey);
    if (!last) return null;
    const saved = JSON.parse(last);
    return { csv: saved.csv, syncedAt: saved.syncedAt, stale: true };
  }
}

export async function loadSumber(env) {
  const kering = await readKind(env, 'pengeringan');
  const giling = await readKind(env, 'penggilingan');
  if (!kering || !giling) {
    return { error: apiError(503, 'SOURCE_UNAVAILABLE', 'Sumber Google Sheet tidak tersedia.') };
  }
  const a = parseJenis(kering.csv, 'pengeringan');
  const b = parseJenis(giling.csv, 'penggilingan');
  const statusSet = new Set(STATUS_TETAP);
  const hasilSet = new Set(HASIL_TETAP);
  for (const rec of a.records) if (rec.bawaan.statusSampel) statusSet.add(rec.bawaan.statusSampel);
  for (const rec of b.records) if (rec.bawaan.hasilPencacahan) hasilSet.add(rec.bawaan.hasilPencacahan);
  return {
    records: a.records.concat(b.records),
    syncedAt: kering.syncedAt < giling.syncedAt ? kering.syncedAt : giling.syncedAt,
    stale: Boolean(kering.stale || giling.stale),
    opsi: {
      statusSampel: [...statusSet].sort((x, y) => x.localeCompare(y, 'id')),
      hasilPencacahan: [...hasilSet],
      slots: SLOTS.map(([slot, pengeringan, penggilingan]) => ({ slot, label: { pengeringan, penggilingan } })),
    },
  };
}
