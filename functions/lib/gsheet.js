import gsheets from '../../data/gsheets.json' with { type: 'json' };
import { apiError, apiOk } from './errors.js';

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

export function sheetCatalog() {
  return gsheets.map(([bidang, survei, label, sid, gid]) => ({
    bidang, survei, label, sid, gid: String(gid),
  }));
}

export function allowedPair(sid, gid) {
  const want = String(gid);
  return sheetCatalog().some(sheet => sheet.sid === sid && sheet.gid === want);
}

function pack(rows, syncedAt, stale) {
  return apiOk({ rows, meta: { syncedAt, stale } });
}

export async function readAllowedSheet(env, sid, gid) {
  const gidText = String(gid || '0');
  if (!allowedPair(sid, gidText)) return apiError(404, 'NOT_FOUND', 'Sheet tidak terdaftar.');
  const kv = env && env.SESSIONS;
  const freshKey = 'mon:fresh:' + sid + ':' + gidText;
  const lastKey = 'mon:last:' + sid + ':' + gidText;
  if (env && env.GSHEET_FORCE_FAIL) {
    const last = kv ? await kv.get(lastKey) : null;
    if (!last) return apiError(503, 'SOURCE_UNAVAILABLE', 'Sumber Google Sheet tidak tersedia.');
    const saved = JSON.parse(last);
    return pack(saved.rows, saved.syncedAt, true);
  }
  const inline = env && env.GSHEET_CSV && env.GSHEET_CSV[sid + ':' + gidText];
  if (typeof inline === 'string') {
    const rows = parseCsv(inline);
    const syncedAt = new Date().toISOString();
    if (kv) await kv.put(lastKey, JSON.stringify({ rows, syncedAt }));
    return pack(rows, syncedAt, false);
  }
  if (kv) {
    const fresh = await kv.get(freshKey);
    if (fresh) {
      const saved = JSON.parse(fresh);
      return pack(saved.rows, saved.syncedAt, false);
    }
  }
  const remote = 'https://docs.google.com/spreadsheets/d/' + sid + '/export?format=csv&gid=' + encodeURIComponent(gidText);
  try {
    const resp = await fetch(remote, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new Error('status ' + resp.status);
    const csv = await resp.text();
    if (csv.length > 8_000_000) throw new Error('terlalu besar');
    const rows = parseCsv(csv);
    const syncedAt = new Date().toISOString();
    const saved = JSON.stringify({ rows, syncedAt });
    if (kv) {
      await kv.put(lastKey, saved);
      await kv.put(freshKey, saved, { expirationTtl: TTL });
    }
    return pack(rows, syncedAt, false);
  } catch {
    if (kv) {
      const last = await kv.get(lastKey);
      if (last) {
        const saved = JSON.parse(last);
        return pack(saved.rows, saved.syncedAt, true);
      }
    }
    return apiError(503, 'SOURCE_UNAVAILABLE', 'Sumber Google Sheet tidak tersedia.');
  }
}
