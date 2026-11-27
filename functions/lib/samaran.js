// K5: penyamaran data monitoring untuk PML, dilakukan di SERVER.
// Hanya salinan keluaran yang diubah; cache tidak pernah disentuh.
// Aturan kolom ditentukan dari nama header (lihat ATURAN). Selain itu setiap sel
// dipindai pola NIK 16 digit, nomor HP, dan email.

const PENANDA = new Set(['', '-', '#n/a', '#ref!', '#value!', '#div/0!', '#name?', '#error!', '()']);
const LABEL = '[disamarkan]';

function norm(h) {
  return String(h ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Urutan penting: aturan pertama yang cocok dipakai.
const ATURAN = [
  // Kolom petugas (PCL/PML/pengawas) dan foto non-KTP dibiarkan.
  { jenis: 'biarkan', re: /^(foto|upload|dokumentasi)\b(?!.*\bktp\b)/ },
  { jenis: 'biarkan', re: /^(nama[ _]?)?(pcl|pml|pcs|pms|pengawas|supervisor|pencacah|petugas)\b/ },
  { jenis: 'nik', re: /^(nik|no\.? ?ktp|nomor ktp|nomor induk kependudukan)$/ },
  { jenis: 'penuh', re: /\bktp\b/ },
  { jenis: 'email', re: /e-?mail/ },
  { jenis: 'telp', re: /(^|[^a-z])(telp|telpon|telepon|tlp|hp|wa|whatsapp|handphone|kontak)([^a-z]|$)/ },
  { jenis: 'penuh', re: /(alamat|koordinat|latitude|longitude|gmaps|^lat$|^lon$|^lng$|^long$|^rt(_op)?$|^rw(_op)?$|^rt ?\/ ?rw$|^jalan$|dusun|^lokasi)/ },
  { jenis: 'singkat', re: /(^nama? responden|nama (kk|krt|ruta|kepala|narahubung|pengelola|pengusaha|usaha|unit usaha|perusahaan|lengkap|upb|utl|utp)|namapengelola|nama unit|nm_usaha|nama_cp|cek ruta|^nama$|nama kk tanaman desa)/ },
];

export function jenisKolom(header) {
  const h = norm(header);
  if (!h) return 'penuh';
  for (const a of ATURAN) if (a.re.test(h)) return a.jenis === 'biarkan' ? null : a.jenis;
  return null;
}

function digitSaja(v) {
  return String(v).replace(/\D/g, '');
}

export function samarkanNik(v) {
  const d = digitSaja(v);
  if (d.length < 8) return LABEL;
  return d.slice(0, 4) + '*'.repeat(d.length - 8) + d.slice(-4);
}

export function samarkanTelp(v) {
  const d = digitSaja(v);
  if (d.length < 6) return LABEL;
  return '*'.repeat(d.length - 3) + d.slice(-3);
}

export function samarkanEmail(v) {
  const s = String(v).trim();
  const at = s.lastIndexOf('@');
  if (at < 1) return LABEL;
  return '***@' + s.slice(at + 1);
}

export function singkatNama(v) {
  const kata = String(v).trim().split(/\s+/).filter(Boolean);
  if (!kata.length) return '';
  if (kata.length === 1) return kata[0].charAt(0) + '***';
  return kata[0] + ' ' + kata.slice(1).map(k => k.charAt(0).toUpperCase() + '.').join(' ');
}

const RE_NIK = /(?<![\d.,])\d{16}(?![\d.,])/g;
// Kolom kode wilayah/sampel berisi angka 16 digit yang BUKAN NIK.
const KOLOM_KODE = /(kode|^id|[ _]id\b|^id|identitas|nks|nus|sbr|subsls|sub sls|segmen|nbs|nsbs|^kip$|listing|^no\.?$|nomor urut|kd)/;
const RE_TELP = /(?<![\d.,])(?:\+62|62|0)8\d{7,11}(?!\d)/g;
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function pindaiNilai(v, header) {
  const s = String(v ?? '');
  if (!s) return { nilai: s, berubah: false };
  const kode = header != null && KOLOM_KODE.test(norm(header));
  const out = s
    .replace(RE_NIK, m => (kode ? m : samarkanNik(m)))
    .replace(RE_TELP, m => samarkanTelp(m))
    .replace(RE_EMAIL, m => samarkanEmail(m));
  return { nilai: out, berubah: out !== s };
}

function terapkan(jenis, v) {
  if (PENANDA.has(String(v ?? '').trim().toLowerCase())) return v;
  if (jenis === 'nik') return samarkanNik(v);
  if (jenis === 'telp') return samarkanTelp(v);
  if (jenis === 'email') return samarkanEmail(v);
  if (jenis === 'singkat') return singkatNama(v);
  return LABEL;
}

// rows: matriks mentah; headerRow: 1-based (0 = tidak ada). override: {namaHeader: jenis|'biarkan'}.
export function samarkanRows(rows, headerRow, override) {
  const header = headerRow ? (rows[headerRow - 1] || []) : [];
  const lebar = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const ov = new Map(Object.entries(override || {}).map(([k, v]) => [norm(k), v]));
  const jenisPerKolom = [];
  for (let c = 0; c < lebar; c++) {
    const h = header[c];
    let j = headerRow ? jenisKolom(h) : null;
    if (ov.has(norm(h))) j = ov.get(norm(h)) === 'biarkan' ? null : ov.get(norm(h));
    jenisPerKolom.push(j);
  }
  const kolomDisamarkan = [];
  jenisPerKolom.forEach((j, c) => {
    if (j) kolomDisamarkan.push({ indeks: c, kolom: String(header[c] ?? ''), jenis: j });
  });
  let selPindai = 0;
  const out = rows.map((r, ri) => {
    if (headerRow && ri === headerRow - 1) return r.slice();
    return r.map((v, c) => {
      const j = headerRow && ri >= headerRow ? jenisPerKolom[c] : null;
      if (j) return terapkan(j, v);
      const p = pindaiNilai(v, headerRow && ri >= headerRow ? header[c] : null);
      if (p.berubah) selPindai++;
      return p.nilai;
    });
  });
  return { rows: out, kolomDisamarkan, selPindai };
}
