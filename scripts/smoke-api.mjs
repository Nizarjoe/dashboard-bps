// Login, baca/tulis D1, unggah/unduh, dan sesi yang bertahan setelah proses baru.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.API_PORT || 8792);
const persist = path.join(root, '.wrangler', 'smoke-api');
const base = 'http://127.0.0.1:' + port;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function wrangler(args) {
  const r = spawnSync('npx', ['wrangler', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.status !== 0) fail((r.stdout || '') + (r.stderr || '') + '\nwrangler gagal: ' + args.join(' '));
  return r.stdout || '';
}

function startWrangler() {
  const child = spawn('npx', ['wrangler', 'pages', 'dev', 'dist',
    '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '9232',
    '--persist-to', persist, '--show-interactive-dev-session=false', '--log-level', 'warn',
  ], {
    cwd: root,
    detached: true,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  child.trace = () => log;
  return child;
}

async function waitReady(child) {
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    if (child.exitCode != null) fail('wrangler berhenti\n' + child.trace());
    try {
      const r = await fetch(base + '/api/constants');
      if (r.ok) return;
    } catch { /* belum dengar */ }
    await new Promise(r => setTimeout(r, 250));
  }
  fail('wrangler tidak siap\n' + child.trace());
}

async function stop(child) {
  if (!child) return;
  const pid = child.pid;
  const signal = (sig) => {
    try { process.kill(-pid, sig); } catch { try { child.kill(sig); } catch { /* sudah mati */ } }
  };
  signal('SIGTERM');
  const t0 = Date.now();
  while (child.exitCode == null && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 100));
  signal('SIGKILL');
  child.stdout.destroy();
  child.stderr.destroy();
}

async function login(username) {
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: username }),
  });
  const body = await res.json();
  if (!body.ok) fail('login ' + username + ' gagal ' + JSON.stringify(body));
  return body;
}

function auth(token) {
  return { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
}

async function counts(dir, label) {
  const out = wrangler(['d1', 'execute', 'sinta-padi', '--local', '--persist-to', dir, '--json', '--command',
    "SELECT sheet, COUNT(*) AS n FROM sheet_row GROUP BY sheet ORDER BY sheet"]);
  const parsed = JSON.parse(out);
  const rows = (parsed[0] && parsed[0].results) || parsed.results || [];
  console.log(label, rows.map(r => r.sheet + '=' + r.n).join(' '));
  return rows;
}

const csvMod = await import(pathToFileURL(path.join(root, 'functions', 'lib', 'gsheet.js')).href);
const parsed = csvMod.parseCsv('a,"b,c",d\n1,"x""y",3\n');
if (parsed[0].join('|') !== 'a|b,c|d' || parsed[1][1] !== 'x"y') fail('parser CSV meleset ' + JSON.stringify(parsed));
const rowsMod = await import(pathToFileURL(path.join(root, 'functions', 'lib', 'rows.js')).href);
if (rowsMod.isCadangan({ cadangan: 1, jenis: 'Utama' }) !== true) fail('flag 1 harus cadangan');
if (rowsMod.isCadangan({ cadangan: 0, jenis: 'Cadangan' }) !== false) fail('flag 0 mengalahkan jenis');
if (rowsMod.isCadangan({ cadangan: null, jenis: 'Cadangan' }) !== true) fail('flag kosong memakai jenis');
if (rowsMod.isCadangan({ jenis: 'Utama' }) !== false) fail('tanpa flag dan bukan cadangan');
console.log('parser csv ok');

const files = await import(pathToFileURL(path.join(root, 'functions', 'lib', 'files.js')).href);
class MemoryKV {
  constructor() { this.map = new Map(); }
  async put(k, v) { this.map.set(k, v); }
  async get(k, opts) {
    const v = this.map.get(k);
    if (!v) return null;
    if (opts && opts.type === 'arrayBuffer') return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
    return v;
  }
  async delete(k) { this.map.delete(k); }
}
function memDb() {
  const rows = new Map();
  return {
    prepare(sql) {
      return { bind(...a) { return {
        async run() { if (sql.startsWith('INSERT')) rows.set(a[0], { key: a[0], mime: a[1], size: a[2], kode: a[3], backend: a[4] }); },
        async first() { return rows.get(a[0]) || null; },
      }; } };
    },
  };
}
const kvEnv = { SESSIONS: new MemoryKV(), DB: memDb() };
const small = await files.upload(new Request('https://x/api/upload', { method: 'POST', body: PNG }), kvEnv, { kode: '3305', role: 'kab' });
const smallBody = await small.json();
if (smallBody.backend !== 'kv') fail('cadangan KV gagal ' + JSON.stringify(smallBody));
const got = Buffer.from(await (await files.download(kvEnv, { kode: '3305', role: 'kab' }, smallBody.file)).arrayBuffer());
if (!got.equals(PNG)) fail('unduh cadangan KV tidak sama');
const big = new Uint8Array(201 * 1024);
big.set(PNG);
const tooBig = await files.upload(new Request('https://x/api/upload', { method: 'POST', body: big }), kvEnv, { kode: '3305', role: 'kab' });
if (tooBig.status !== 503) fail('berkas besar tanpa R2 harus 503, dapat ' + tooBig.status);
console.log('cadangan kv ok');

const built = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-worker.mjs')], { cwd: root, stdio: 'inherit' });
if (built.status !== 0) fail('build:worker gagal');

await rm(persist, { recursive: true, force: true });
wrangler(['d1', 'migrations', 'apply', 'sinta-padi', '--local', '--persist-to', persist]);
const tmp = await mkdtemp(path.join(tmpdir(), 'sinta-sql-'));
const miniSql = path.join(tmp, 'mini.sql');
const mini = spawnSync(process.execPath, [path.join(root, 'scripts', 'import-db-sql.mjs'), path.join(root, 'scripts', 'fixtures', 'mini-db.json')], { encoding: 'utf8' });
if (mini.status !== 0) fail(mini.stderr || 'impor mini gagal');
await writeFile(miniSql, mini.stdout);
wrangler(['d1', 'execute', 'sinta-padi', '--local', '--persist-to', persist, '--file', miniSql]);

const realPersist = path.join(root, '.wrangler', 'smoke-import');
await rm(realPersist, { recursive: true, force: true });
wrangler(['d1', 'migrations', 'apply', 'sinta-padi', '--local', '--persist-to', realPersist]);
const realSql = path.join(tmp, 'real.sql');
const real = spawnSync(process.execPath, [path.join(root, 'scripts', 'import-db-sql.mjs'), path.join(root, 'data', 'db.json')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (real.status !== 0) fail(real.stderr || 'impor db.json gagal');
await writeFile(realSql, real.stdout);
wrangler(['d1', 'execute', 'sinta-padi', '--local', '--persist-to', realPersist, '--file', realSql]);
const imported = await counts(realPersist, 'db.json');
const expect = { panen: 1143, panen33: 68, utker: 1125, utgil: 24, 'ksa-mei': 1143, 'ksa-juni': 1143, kering1: 1125, direktori: 24 };
for (const [sheet, n] of Object.entries(expect)) {
  const hit = imported.find(r => r.sheet === sheet);
  if (!hit || Number(hit.n) !== n) fail('jumlah ' + sheet + ' = ' + (hit && hit.n) + ', diharapkan ' + n);
}
console.log('impor db.json ok');

let child = startWrangler();
try {
  await waitReady(child);
  const kab = await login('3305');
  const me1 = await (await fetch(base + '/api/me', { headers: auth(kab.token) })).json();
  if (me1.user?.kode !== '3305' || me1.user?.nama !== 'KEBUMEN') fail('/api/me ' + JSON.stringify(me1));

  const rl = await (await fetch(base + '/api/realisasi', { headers: auth(kab.token) })).json();
  const cil = rl.rows.find(r => r.kode === '3301');
  if (!cil || cil.tK !== 128 || cil.rK !== 54 || cil.tK2 !== 47 || cil.rK2 !== 47 || cil.ku !== 2 || cil.kc !== 0) {
    fail('realisasi 3301 ' + JSON.stringify(cil));
  }
  const keb = rl.rows.find(r => r.kode === '3305');
  if (!keb || keb.ku !== 1 || keb.kc !== 2) fail('sampel utama/cadangan 3305 ' + JSON.stringify(keb));
  const sumKu = rl.rows.reduce((a, r) => a + r.ku, 0);
  const sumKc = rl.rows.reduce((a, r) => a + r.kc, 0);
  if (rl.total.ku !== sumKu || rl.total.kc !== sumKc) fail('total ku/kc ' + JSON.stringify(rl.total));

  const hijack = await (await fetch(base + '/api/realisasi?kab=3301', { headers: auth(kab.token) })).json();
  if (hijack.rows.some(r => r.kode === '3301' && r.nama === 'CILACAP' && hijack.rows.length === 1 && hijack.rows[0].kode === '3301')) {
    fail('3305 mendapat Cilacap');
  }
  if (hijack.rows.length !== 1 || hijack.rows[0].kode !== '3305' || hijack.rows[0].nama === 'CILACAP') {
    fail('?kab=3301 untuk 3305 harus dibatasi ke 3305: ' + JSON.stringify(hijack.rows));
  }
  if (hijack.total.ku !== hijack.rows[0].ku || hijack.total.kc !== hijack.rows[0].kc) fail('total filter tidak ikut ku/kc');

  const sheetHijack = await (await fetch(base + '/api/sheet/panen?kab=3301', { headers: auth(kab.token) })).json();
  if ((sheetHijack.data || []).some(r => r.kdkab === '3301')) fail('sheet 3305 membocorkan 3301');
  const ksaHijack = await (await fetch(base + '/api/ksa-rekap?bulan=Mei&kab=3301', { headers: auth(kab.token) })).json();
  if ((ksaHijack.rows || []).some(r => r.kab === '3301')) fail('rekap KSA membocorkan 3301');
  const monHijack = await (await fetch(base + '/api/monitoring-gc?jenis=Utama&kab=3301', { headers: auth(kab.token) })).json();
  if ((monHijack.rows || []).length !== 1 || monHijack.rows[0].kode !== '3305') fail('monitoring membocorkan kabupaten lain');

  const kpi = await (await fetch(base + '/api/kpi', { headers: auth(kab.token) })).json();
  if (kpi.utamaKering !== sumKu || kpi.cadanganKering !== sumKc || kpi.utamaGiling !== 1 || kpi.keringT1 !== 1 || kpi.cadanganGiling !== 0) {
    fail('kpi tidak sama dengan ku/kc ' + JSON.stringify(kpi) + ' ku=' + sumKu + ' kc=' + sumKc);
  }

  const panen = await (await fetch(base + '/api/sheet/panen', { headers: auth(kab.token) })).json();
  if (panen.data.length !== 1 || panen.data[0].id !== '330501A1') fail('filter kabupaten panen ' + JSON.stringify(panen.data));
  const admin = await login('0000');
  const all = await (await fetch(base + '/api/sheet/panen', { headers: auth(admin.token) })).json();
  if (all.data.length !== 2) fail('admin harus melihat 2 panen, dapat ' + all.data.length);
  const prov = await (await fetch(base + '/api/realisasi?kab=3301', { headers: auth(admin.token) })).json();
  if (prov.rows.length !== 1 || prov.rows[0].kode !== '3301' || prov.rows[0].nama !== 'CILACAP') {
    fail('admin harus boleh memfilter 3301: ' + JSON.stringify(prov.rows));
  }
  const paksa = await (await fetch(base + '/api/sheet/panen33', {
    method: 'POST', headers: auth(kab.token),
    body: JSON.stringify({ action: 'submit', data: { kab: '3301', petugas: 'P', jenis: 'Utama', id: 'X1', hasil: '1. Belum Panen' } }),
  })).json();
  if (!paksa.success) fail('submit paksa kab gagal ' + JSON.stringify(paksa));
  const milik = await (await fetch(base + '/api/sheet/panen33', { headers: auth(kab.token) })).json();
  if (!milik.data.some(r => r.id === 'X1' && r.kab === '3305')) fail('submit 3305 harus tersimpan sebagai 3305');
  const ubahOrang = await fetch(base + '/api/sheet/panen', {
    method: 'POST', headers: auth(kab.token),
    body: JSON.stringify({ action: 'updateCell', matchValue: '330101A1', targetColumn: 'pengganti', value: 'CURI' }),
  });
  if (ubahOrang.status !== 403) fail('updateCell kabupaten lain harus 403, dapat ' + ubahOrang.status);

  const upd = await (await fetch(base + '/api/sheet/panen', {
    method: 'POST', headers: auth(kab.token),
    body: JSON.stringify({ action: 'updateCell', matchValue: '330501A1', targetColumn: 'pengganti', value: 'CAD-1' }),
  })).json();
  if (!upd.success) fail('updateCell ' + JSON.stringify(upd));

  const kirim = await (await fetch(base + '/api/sheet/kering2', {
    method: 'POST', headers: auth(kab.token),
    body: JSON.stringify({ action: 'submit', data: { kab: '3305', petugas: 'P', jenis: 'Utama', id: '330501U1', hasil: '1. Berhasil diwawancarai', tgl1: '2026-06-01', lok1: '-7.1, 109.1', w305a: '1', w305b: '2', w305c: '3' } }),
  })).json();
  if (!kirim.success) fail('kering2 ' + JSON.stringify(kirim));

  const up = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + kab.token, 'content-type': 'application/octet-stream' },
    body: PNG,
  });
  const upBody = await up.json();
  if (!up.ok || !upBody.file || upBody.backend !== 'r2') fail('unggah gagal ' + up.status + ' ' + JSON.stringify(upBody) + '\n' + child.trace());
  const gs = await (await fetch(base + '/api/gsheets', { headers: auth(kab.token) })).json();
  if (!Array.isArray(gs.sheets) || gs.sheets.length !== 35) fail('daftar gsheet ' + (gs.sheets && gs.sheets.length));
  const badSid = await fetch(base + '/api/gsheet?sid=../rahasia&gid=0', { headers: auth(kab.token) });
  if (badSid.status !== 400) fail('sid tidak valid harus 400, dapat ' + badSid.status);

  await stop(child);
  child = startWrangler();
  await waitReady(child);

  const me2 = await fetch(base + '/api/me', { headers: auth(kab.token) });
  if (me2.status !== 200) fail('sesi hilang setelah proses baru ' + me2.status);
  const kering = await (await fetch(base + '/api/sheet/kering2', { headers: auth(kab.token) })).json();
  if (kering.data.length !== 1 || kering.data[0].tgl1 !== '2026-06-01') fail('kering2 hilang ' + JSON.stringify(kering));
  const panen2 = await (await fetch(base + '/api/sheet/panen', { headers: auth(kab.token) })).json();
  if (panen2.data[0].pengganti !== 'CAD-1') fail('updateCell tidak tersimpan');
  const file = await fetch(base + upBody.url, { headers: { authorization: 'Bearer ' + kab.token } });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (file.status !== 200 || !bytes.equals(PNG)) fail('unduh berkas ' + file.status + ' ukuran ' + bytes.length);
  const anon = await fetch(base + upBody.url);
  if (anon.status !== 401) fail('unduh tanpa login harus 401, dapat ' + anon.status);
  const lain = await login('3301');
  const curi = await fetch(base + upBody.url, { headers: { authorization: 'Bearer ' + lain.token } });
  if (curi.status !== 403) fail('unduh berkas kabupaten lain harus 403, dapat ' + curi.status);
  const dead = await fetch(base + '/api/logout', { method: 'POST', headers: { authorization: 'Bearer ' + kab.token } });
  const again = await fetch(base + '/api/logout', { method: 'POST', headers: { authorization: 'Bearer ' + kab.token } });
  const junk = await fetch(base + '/api/logout', { method: 'POST', headers: { authorization: 'Bearer bukan-token' } });
  if (dead.status !== 200 || again.status !== 200 || junk.status !== 200) {
    fail('logout harus idempoten 200, dapat ' + dead.status + '/' + again.status + '/' + junk.status);
  }
  const after = await fetch(base + '/api/me', { headers: auth(kab.token) });
  if (after.status !== 401) fail('sesi masih hidup setelah logout ' + after.status);

  const made = await (await fetch(base + '/api/users', {
    method: 'POST', headers: auth((await login('9999')).token),
    body: JSON.stringify({ kode: '3399', nama: 'Uji', role: 'kab' }),
  })).json();
  if (!made.ok) fail('tambah pengguna ' + JSON.stringify(made));
  const extra = await login('3399');
  if (extra.user?.role !== 'kab') fail('pengguna baru tidak bisa masuk');
  console.log('wrangler api ok');
} finally {
  await stop(child);
}

const marker = await readFile(path.join(root, 'dist', '_worker.js'), 'utf8');
if (!marker.includes('SINTA PADI')) fail('dist/_worker.js tidak berisi bundel');
console.log('smoke api ok');
process.exit(0);
