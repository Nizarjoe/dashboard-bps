// Katalog monitoring v2: 70 tab dari Google Sites "Monitoring Produksi 3305".
// Sumber: data/monitoring-katalog.json (kurasi manual + scripts/sync-katalog.mjs).
import doc from '../../data/monitoring-katalog.json' with { type: 'json' };

export const BIDANG = ['tp', 'inpek', 'horti'];

const SHEETS = doc.sheets;
const BY_ID = new Map(SHEETS.map(s => [s.id, s]));
const BY_PAIR = new Map(SHEETS.map(s => [s.sid + ':' + String(s.gid), s]));

export function katalogMeta() {
  return { versi: doc.versi, diperbarui: doc.diperbarui, sumber: doc.sumber };
}

export function semuaTab() {
  return SHEETS;
}

export function cariTab({ id, sid, gid } = {}) {
  if (id) return BY_ID.get(String(id)) || null;
  if (sid) return BY_PAIR.get(String(sid) + ':' + String(gid == null || gid === '' ? '0' : gid)) || null;
  return null;
}

// Bentuk publik satu entri katalog. Field lama (bidang, survei, label, sid, gid)
// tetap ada agar frontend lama tidak berubah perilaku.
export function itemPublik(s) {
  const out = {
    id: s.id,
    bidang: s.bidang,
    survei: s.survei,
    periode: s.periode ?? null,
    jenis: s.jenis ?? null,
    tahun: s.tahun,
    arsip: Boolean(s.arsip),
    label: s.label,
    sid: s.sid,
    gid: String(s.gid),
    tersedia: s.tersedia !== false,
    alasan: s.tersedia === false ? { kode: s.alasan.kode, pesan: s.alasan.pesan } : null,
    headerRow: s.headerRow ?? null,
    ringkasan: Boolean(s.ringkasan),
    tautan: (s.tautan || []).map(t => ({ jenis: t.jenis, label: t.label, url: t.url, perluCek: Boolean(t.perluCek) })),
  };
  return out;
}

// Filter daftar. Arsip disembunyikan kecuali arsip === true diminta eksplisit.
export function daftarTab({ bidang, arsip } = {}) {
  return SHEETS.filter(s => (!bidang || s.bidang === bidang) && (arsip === true || !s.arsip));
}

export function bacaParamArsip(url) {
  const v = url.searchParams.get('arsip');
  return v === '1' || v === 'true' || v === 'ya';
}
