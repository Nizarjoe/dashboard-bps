import { CONSTANTS } from './constants.js';
import { json } from './http.js';

const HASIL_OK = CONSTANTS.hasilPencacahan[0];
const PEMANEN = CONSTANTS.jenisPemanenan;

function num(v) {
  return Number(v || 0);
}

export async function realisasi(url, env) {
  const [targets, counts] = await env.DB.batch([
    env.DB.prepare('SELECT kode, jenis, t, r FROM target'),
    env.DB.prepare(`SELECT kab, cadangan, COUNT(*) AS n FROM sheet_row
      WHERE sheet = 'utker' AND status = 'Eligible' GROUP BY kab, cadangan`),
  ]);
  const tg = {};
  for (const row of targets.results) {
    tg[row.kode] = tg[row.kode] || {};
    tg[row.kode][row.jenis] = { t: num(row.t), r: num(row.r) };
  }
  const eligible = {};
  for (const row of counts.results) {
    eligible[row.kab] = eligible[row.kab] || { u: 0, c: 0 };
    if (Number(row.cadangan) === 1) eligible[row.kab].c += num(row.n);
    else eligible[row.kab].u += num(row.n);
  }
  let rows = CONSTANTS.kabupaten.map(([kode, nama]) => {
    const k = tg[kode] || {};
    const kering = k.kering || { t: 0, r: 0 };
    const kering2 = k.kering2 || { t: 0, r: 0 };
    const giling = k.giling || { t: 0, r: 0 };
    const el = eligible[kode] || { u: 0, c: 0 };
    return {
      kode, nama,
      tK: kering.t, rK: kering.r,
      // tK2 mengikuti server.js: kedua nilai memakai realisasi, bukan target.
      tK2: kering2.r, rK2: kering2.r,
      tG: giling.t, rG: giling.r,
      ku: el.u, kc: el.c,
    };
  });
  const only = url.searchParams.get('kab');
  if (only) rows = rows.filter(r => r.kode === only);
  const total = rows.reduce((a, r) => ({
    tK: a.tK + r.tK, rK: a.rK + r.rK, tK2: a.tK2 + r.tK2, rK2: a.rK2 + r.rK2, tG: a.tG + r.tG, rG: a.rG + r.rG,
  }), { tK: 0, rK: 0, tK2: 0, rK2: 0, tG: 0, rG: 0 });
  return json(200, { rows, total });
}

export async function kpi(env) {
  const [ut, gil, kr] = await env.DB.batch([
    env.DB.prepare(`SELECT
      SUM(CASE WHEN status = 'Eligible' AND jenis != 'Cadangan' THEN 1 ELSE 0 END) AS elU,
      SUM(CASE WHEN status = 'Eligible' AND jenis = 'Cadangan' THEN 1 ELSE 0 END) AS elC,
      SUM(CASE WHEN status = 'Eligible' AND cadangan = 0 THEN 1 ELSE 0 END) AS elU2,
      SUM(CASE WHEN status = 'Eligible' AND cadangan = 1 THEN 1 ELSE 0 END) AS elC2
      FROM sheet_row WHERE sheet = 'utker'`),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM sheet_row WHERE sheet = 'utgil' AND status = 'Eligible'`),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM sheet_row WHERE sheet = 'kering1' AND hasil = ?1`).bind(HASIL_OK),
  ]);
  const u = ut.results[0] || {};
  const elU2 = num(u.elU2);
  const elU = num(u.elU);
  const elC2 = num(u.elC2);
  const elC = num(u.elC);
  return json(200, {
    utamaKering: elU2 || elU,
    cadanganKering: elC2 || elC,
    utamaGiling: num(gil.results[0] && gil.results[0].n),
    cadanganGiling: 0,
    keringT1: num(kr.results[0] && kr.results[0].n),
  });
}

export async function ksaRekap(url, env, me) {
  const bulan = url.searchParams.get('bulan') || 'Mei';
  const sheet = bulan === 'Juni' ? 'ksa-juni' : 'ksa-mei';
  const { results } = await env.DB.prepare(
    `SELECT kab,
      SUM(CASE WHEN petak = 'Tidak Ada' THEN 1 ELSE 0 END) AS tdk,
      SUM(CASE WHEN petak = 'Ya, Fase V2' THEN 1 ELSE 0 END) AS v2,
      SUM(CASE WHEN petak = 'Ya, Fase G1' THEN 1 ELSE 0 END) AS g1,
      SUM(CASE WHEN petak = 'Ya, Fase G2' THEN 1 ELSE 0 END) AS g2,
      SUM(CASE WHEN petak = 'Ya, Fase G3' THEN 1 ELSE 0 END) AS g3
     FROM sheet_row WHERE sheet = ?1 GROUP BY kab`
  ).bind(sheet).all();
  const re = {};
  for (const r of results) re[r.kab] = r;
  const rows = CONSTANTS.kabupaten.filter(([k]) => me.role === 'kab' ? k === me.kode : true).map(([k, n]) => {
    const x = re[k] || {};
    const tdk = num(x.tdk), v2 = num(x.v2), g1 = num(x.g1), g2 = num(x.g2), g3 = num(x.g3);
    return { kab: k, nama: n, target: tdk + v2 + g1 + g2 + g3, tdk, v2, g1, g2, g3 };
  });
  return json(200, { rows });
}

export async function monitoringGc(url, env) {
  const jenis = url.searchParams.get('jenis') || 'Utama';
  const { results } = await env.DB.prepare(
    `SELECT kab, hasil, petak, pemanen, COUNT(*) AS n
     FROM sheet_row WHERE sheet = 'panen33' AND jenis = ?1
     GROUP BY kab, hasil, petak, pemanen`
  ).bind(jenis).all();
  const agg = {};
  for (const r of results) {
    const kab = r.kab;
    const n = num(r.n);
    const a = agg[kab] || (agg[kab] = { belum: 0, sudah: 0, ya: 0, tdk: 0, sendiri: 0, tj: 0, ttj: 0 });
    if (r.hasil === '1. Belum Panen') a.belum += n;
    else if (r.hasil === '2. Sudah Panen') a.sudah += n;
    if (r.petak === '1. Ya') a.ya += n;
    else if (r.petak === '2. Tidak') a.tdk += n;
    if (r.pemanen === PEMANEN[0]) a.sendiri += n;
    else if (r.pemanen === PEMANEN[1]) a.tj += n;
    else if (r.pemanen === PEMANEN[2]) a.ttj += n;
  }
  const rows = CONSTANTS.kabupaten.map(([k, n]) => {
    const a = agg[k] || { belum: 0, sudah: 0, ya: 0, tdk: 0, sendiri: 0, tj: 0, ttj: 0 };
    return { kode: k, nama: n, ...a, total: a.belum + a.sudah };
  });
  const total = rows.reduce((a, r) => ({
    belum: a.belum + r.belum, sudah: a.sudah + r.sudah, ya: a.ya + r.ya, tdk: a.tdk + r.tdk,
    sendiri: a.sendiri + r.sendiri, tj: a.tj + r.tj, ttj: a.ttj + r.ttj, total: a.total + r.total,
  }), { belum: 0, sudah: 0, ya: 0, tdk: 0, sendiri: 0, tj: 0, ttj: 0, total: 0 });
  return json(200, { rows, total });
}
