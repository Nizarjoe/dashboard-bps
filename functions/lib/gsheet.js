import gsheets from '../../data/gsheets.json' with { type: 'json' };
import { json } from './http.js';

const TTL = 300;

export function parseCsv(csv) {
  const rows = [];
  let row = [];
  let cell = '';
  let inq = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inq) {
      if (ch === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inq = false;
      else cell += ch;
    } else if (ch === '"') inq = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') continue;
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const data = rows.filter(r => r.some(v => String(v).trim() !== ''));
  if (!data.length) return [];
  let lastCol = 0;
  data.forEach(r => r.forEach((v, ci) => { if (String(v).trim() !== '') lastCol = Math.max(lastCol, ci); }));
  return data.map(r => r.slice(0, lastCol + 1));
}

export function listGsheets() {
  return json(200, {
    sheets: gsheets.map(([bidang, survei, label, sid, gid]) => ({ bidang, survei, label, sid, gid })),
  });
}

export async function readGsheet(url, env) {
  const sid = url.searchParams.get('sid') || '';
  const gid = url.searchParams.get('gid') || '0';
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(sid) || !/^\d+$/.test(gid)) {
    return json(400, { error: 'sid atau gid tidak valid' });
  }
  const cacheKey = 'gs:v1:' + sid + ':' + gid;
  try {
    const hit = await env.SESSIONS.get(cacheKey);
    if (hit) {
      return new Response(hit, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
  } catch { /* cache meleset, ambil ulang */ }
  const remote = 'https://docs.google.com/spreadsheets/d/' + sid + '/export?format=csv&gid=' + gid;
  let resp;
  try {
    resp = await fetch(remote, { headers: { 'user-agent': 'Mozilla/5.0' } });
  } catch (e) {
    return json(502, { error: 'Gagal memuat sheet: ' + String(e && e.message || e) });
  }
  if (!resp.ok) return json(502, { error: 'Gagal memuat sheet: GSheet fetch ' + resp.status });
  const csv = await resp.text();
  if (csv.length > 8_000_000) return json(502, { error: 'Gagal memuat sheet: berkas terlalu besar' });
  const rows = parseCsv(csv);
  const body = JSON.stringify({ rows });
  try { await env.SESSIONS.put(cacheKey, body, { expirationTtl: TTL }); } catch { /* tetap kirim data */ }
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
