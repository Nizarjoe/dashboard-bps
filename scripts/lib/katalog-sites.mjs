// Parser halaman Google Sites "Monitoring Produksi 3305" dan penggabung katalog.
// Dipakai oleh scripts/sync-katalog.mjs dan tes. Tidak dipakai di runtime Pages.

export const SITUS = 'https://sites.google.com/view/monitoringproduksi3305';

export const HALAMAN = [
  { slug: 'statistik-tanaman-pangan', bidang: 'tp' },
  { slug: 'statistik-inpek', bidang: 'inpek' },
  { slug: 'statistik-horti-per-pet-dan-perikanan', bidang: 'horti' },
];

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, k) => {
    if (k[0] === '#') {
      const n = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[k] != null ? ENT[k] : m;
  });
}

function rapikan(s) {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

// Hilangkan pengalihan google.com/url?q=... agar URL asli yang tersimpan.
export function bukaPengalihan(u) {
  let out = u;
  try {
    const url = new URL(u);
    if (url.hostname === 'www.google.com' && url.pathname === '/url' && url.searchParams.get('q')) {
      out = url.searchParams.get('q');
    }
  } catch { /* biarkan */ }
  return bersihkanUrl(out);
}

// Buang parameter pelacak/identitas pemilik (ouid = ID akun Google pemilik).
export function bersihkanUrl(u) {
  try {
    const url = new URL(u);
    let ubah = false;
    for (const k of ['ouid', 'usp', 'rtpof', 'sd', 'authuser', 'pli']) {
      if (url.searchParams.has(k)) { url.searchParams.delete(k); ubah = true; }
    }
    return ubah ? url.toString() : u;
  } catch {
    return u;
  }
}

export function jenisTautan(u) {
  let url;
  try { url = new URL(u); } catch { return null; }
  if (url.hostname === 'docs.google.com' && url.pathname.startsWith('/spreadsheets/d/')) return 'sheet';
  if (url.hostname === 'docs.google.com' && url.pathname.startsWith('/forms/')) return 'form';
  if (url.hostname === 'drive.google.com') return 'drive';
  if (url.hostname === 's.bps.go.id') return 'lain';
  if (url.hostname === 'sites.google.com') return 'situs';
  return null;
}

export function sheetRef(u) {
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,80})/.exec(u);
  if (!m) return null;
  const g = /[?#&]gid=(\d+)/.exec(u);
  return { sid: m[1], gid: g ? g[1] : '0' };
}

// Pecah HTML menjadi blok berurutan: judul h1-h6 dan paragraf/list item.
// Setiap blok menyimpan teks gabungan dan tautan di dalamnya.
export function parseBlok(html) {
  const body = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const blok = [];
  let cur = null;
  let link = null;
  const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  let m;
  const tutup = () => {
    if (cur) {
      cur.teks = rapikan(cur.teks);
      const hanyaTeksTautan = cur.dalamTautan && !cur.tautan.length;
      if (!hanyaTeksTautan && (cur.teks || cur.tautan.length)) blok.push(cur);
    }
    cur = null;
  };
  while ((m = re.exec(body))) {
    if (m[4] != null) {
      if (link) link.teks += m[4];
      if (cur) cur.teks += m[4];
      continue;
    }
    const end = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (/^h[1-6]$/.test(tag) || tag === 'p' || tag === 'li') {
      if (!end) { tutup(); cur = { tipe: /^h/.test(tag) ? tag : 'p', teks: '', tautan: [], dalamTautan: Boolean(link) }; }
      else if (cur && (cur.tipe === tag || (tag !== 'li' && cur.tipe === 'p'))) tutup();
      continue;
    }
    if (tag === 'a') {
      if (!end) {
        const h = /href="([^"]*)"/i.exec(m[3]);
        link = h ? { url: bukaPengalihan(decodeEntities(h[1])), teks: '' } : null;
      } else if (link) {
        const t = { url: link.url, label: rapikan(link.teks) };
        if (cur && !cur.dalamTautan) cur.tautan.push(t);
        else { tutup(); blok.push({ tipe: 'p', teks: t.label, tautan: [t] }); }
        link = null;
      }
    }
  }
  tutup();
  return blok;
}

// Ubah blok menjadi entri. Tautan dikelompokkan per "run": deretan tautan sheet yang
// berurutan, diikuti deretan tautan non-sheet (form, drive, lain). Semua sheet dalam
// satu run mendapat semua tautan non-sheet run itu. Run diputus oleh judul h2.
// Bagian = judul h2 terakhir, sub = paragraf tanpa tautan terakhir.
export function parseHalaman(html, halaman) {
  const blok = parseBlok(html);
  let bagian = '';
  let sub = '';
  const runs = [];
  let run = null;
  const putus = () => { run = null; };
  for (const b of blok) {
    if (b.tipe === 'h1') continue;
    if (/^h[2-6]$/.test(b.tipe)) { bagian = b.teks; sub = ''; putus(); continue; }
    if (!b.tautan.length) {
      if (b.teks && !/^(Google Sites|Report abuse|Page details|Page updated|Skip to|Search this site|Embedded Files)/i.test(b.teks)) sub = b.teks;
      continue;
    }
    for (const t of b.tautan) {
      const jenis = jenisTautan(t.url);
      if (!jenis || (jenis === 'situs' && /\/view\/monitoringproduksi3305(\/|$)/.test(t.url))) continue;
      const label = t.label || b.teks;
      if (jenis === 'sheet') {
        const ref = sheetRef(t.url);
        if (!ref) continue;
        if (!run || run.lain.length) { run = { sheet: [], lain: [] }; runs.push(run); }
        run.sheet.push({ ...ref, label, bagian, sub });
      } else {
        if (!run) { run = { sheet: [], lain: [] }; runs.push(run); }
        if (!run.lain.some(x => x.url === t.url)) run.lain.push({ jenis: jenis === 'situs' ? 'lain' : jenis, label, url: t.url });
      }
    }
  }
  const out = [];
  for (const r of runs) for (const s of r.sheet) out.push({ halaman, ...s, tautan: r.lain.slice() });
  return out;
}

export function kunci(x) {
  return x.sid + ':' + x.gid;
}

export function tahunDari(teks) {
  const all = [...String(teks).matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1]));
  return all.length ? all[all.length - 1] : null;
}

// Bandingkan katalog dengan hasil parse situs. Tidak mengubah apa pun.
export function bandingkan(katalog, situs) {
  const adaKatalog = new Map(katalog.map(x => [kunci(x), x]));
  const adaSitus = new Map();
  for (const s of situs) if (!adaSitus.has(kunci(s))) adaSitus.set(kunci(s), s);
  const baru = [...adaSitus.values()].filter(s => !adaKatalog.has(kunci(s)));
  const hilang = katalog.filter(x => !adaSitus.has(kunci(x)));
  const tautanBerubah = [];
  for (const x of katalog) {
    const s = adaSitus.get(kunci(x));
    if (!s || x.tautanManual) continue;
    const a = (x.tautan || []).map(t => t.url).sort().join('\n');
    const b = s.tautan.map(t => t.url).sort().join('\n');
    if (a !== b) tautanBerubah.push({ id: x.id, sebelum: (x.tautan || []).length, sesudah: s.tautan.length });
  }
  return { baru, hilang, tautanBerubah };
}

export function idEntri(bidang, sid, gid) {
  return bidang + '-' + sid.slice(0, 8).replace(/[^A-Za-z0-9]/g, 'x') + '-' + gid;
}

// Entri draf untuk tab baru. Kolom kurasi (survei, periode, jenis, ringkasan) diisi manusia.
export function entriDraf(s, bidang) {
  const tahun = tahunDari(s.bagian + ' ' + s.sub + ' ' + s.label);
  return {
    id: idEntri(bidang, s.sid, s.gid),
    bidang,
    survei: s.bagian || s.sub || s.label,
    periode: null,
    jenis: null,
    tahun,
    arsip: tahun != null && tahun < 2026,
    label: s.label,
    sid: s.sid,
    gid: String(s.gid),
    tersedia: true,
    headerRow: null,
    tautan: s.tautan,
    draf: true,
  };
}
