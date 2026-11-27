// Login, sesi KV yang bertahan setelah proses baru, dan bundel _worker.js.
import { spawn, spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.SESSIONS_PORT || 8791);
const persist = path.join(root, '.wrangler', 'smoke-sessions');
const base = 'http://127.0.0.1:' + port;
const BAD = 'Username atau password salah. Hubungi Admin BPS Provinsi Jawa Tengah jika lupa.';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

class MemoryKV {
  constructor() { this.map = new Map(); }
  async get(key) {
    const row = this.map.get(key);
    if (!row) return null;
    if (row.exp && Date.now() > row.exp) { this.map.delete(key); return null; }
    return row.value;
  }
  async put(key, value, opts) {
    const ttl = opts && opts.expirationTtl;
    this.map.set(key, { value, exp: ttl ? Date.now() + ttl * 1000 : 0 });
  }
  async delete(key) { this.map.delete(key); }
}

function req(url, opt) {
  return new Request(url, opt);
}

async function unit() {
  const mod = await import(pathToFileURL(path.join(root, 'functions', 'lib', 'handle.js')).href);
  const kv = new MemoryKV();
  const env = { SESSIONS: kv };
  const bad = await mod.dispatch(req('https://pages.example/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '3305', password: 'salah' }),
  }), env);
  const badBody = await bad.json();
  if (bad.status !== 401 || badBody.error !== BAD) fail('password salah: ' + bad.status + ' ' + JSON.stringify(badBody));

  const login = await mod.dispatch(req('https://pages.example/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ' 3305 ', password: '3305' }),
  }), env);
  const session = await login.json();
  if (!session.ok || session.user.kode !== '3305' || session.user.nama !== 'KEBUMEN' || !/^[0-9a-f]{48}$/.test(session.token)) {
    fail('login kabupaten gagal: ' + JSON.stringify(session));
  }
  const fresh = new MemoryKV();
  for (const [k, v] of kv.map) fresh.map.set(k, v);
  const me = await mod.dispatch(req('https://pages.example/api/me', {
    headers: { authorization: 'Bearer ' + session.token },
  }), { SESSIONS: fresh });
  const meBody = await me.json();
  if (me.status !== 200 || meBody.user.kode !== '3305' || meBody.user.token) fail('sesi tidak bertahan di KV baru: ' + JSON.stringify(meBody));

  const constants = await (await mod.dispatch(req('https://pages.example/api/constants'), env)).json();
  if (!Array.isArray(constants.kabupaten) || constants.kabupaten.length !== 35) fail('constants tidak lengkap');
  const pending = await mod.dispatch(req('https://pages.example/api/sheet/panen', {
    headers: { authorization: 'Bearer ' + session.token },
  }), env);
  const pendingBody = await pending.json();
  if (pending.status !== 503 || !/D1/i.test(String(pendingBody.error))) {
    fail('tanpa D1 harus 503, dapat ' + pending.status + ' ' + JSON.stringify(pendingBody));
  }

  const d1 = {
    prepare() {
      return { bind() { return this; }, async first() { return { kode: '3305', nama: 'DARI D1', role: 'kab', password: '3305' }; } };
    },
  };
  const fromD1 = await (await mod.dispatch(req('https://pages.example/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: '3305', password: '3305' }),
  }), { SESSIONS: kv, DB: d1 })).json();
  if (fromD1.user?.nama !== 'DARI D1') fail('login D1 tidak dipakai: ' + JSON.stringify(fromD1));

  const missingTable = {
    prepare() {
      return { bind() { return this; }, async first() { throw new Error('no such table: users'); } };
    },
  };
  const fallback = await (await mod.dispatch(req('https://pages.example/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: '9999', password: '9999' }),
  }), { SESSIONS: kv, DB: missingTable })).json();
  if (fallback.user?.role !== 'superadmin') fail('seed cadangan gagal: ' + JSON.stringify(fallback));

  const out = await mod.dispatch(req('https://pages.example/api/logout', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + session.token },
  }), env);
  if (out.status !== 200) fail('logout gagal ' + out.status);
  const gone = await mod.dispatch(req('https://pages.example/api/me', {
    headers: { authorization: 'Bearer ' + session.token },
  }), env);
  if (gone.status !== 401) fail('sesi masih hidup setelah logout');

  const proxy = await mod.dispatch(req('https://pages.example/api/constants'), {});
  if (proxy.status !== 503) fail('tanpa SESSIONS harus proxy 503, dapat ' + proxy.status);
  console.log('unit sesi ok');
}

function startWrangler() {
  const child = spawn('npx', ['wrangler', 'pages', 'dev', 'dist',
    '--ip', '127.0.0.1',
    '--port', String(port),
    '--inspector-port', '9231',
    '--persist-to', persist,
    '--show-interactive-dev-session=false',
    '--log-level', 'warn',
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
      const r = await fetch(base + '/');
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

async function pagesDev() {
  await rm(persist, { recursive: true, force: true });
  const built = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-worker.mjs')], { cwd: root, stdio: 'inherit' });
  if (built.status !== 0) fail('build:worker gagal');

  let child = startWrangler();
  try {
    await waitReady(child);
    const home = await (await fetch(base + '/')).text();
    if (!home.includes('SINTA PADI')) fail('beranda tidak terlayani _worker.js');
    const peta = await (await fetch(base + '/peta')).text();
    if (!peta.includes('id="app"')) fail('fallback SPA /peta gagal');

    const bad = await (await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: '3305', password: 'nope' }),
    })).json();
    if (bad.error !== BAD) fail('pesan login salah: ' + JSON.stringify(bad));

    const loginRes = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: '3305', password: '3305' }),
    });
    const session = await loginRes.json();
    if (!session.ok || !session.token) fail('login wrangler gagal: ' + JSON.stringify(session) + '\n' + child.trace());
    const me1 = await (await fetch(base + '/api/me', { headers: { authorization: 'Bearer ' + session.token } })).json();
    if (me1.user?.kode !== '3305') fail('/api/me gagal: ' + JSON.stringify(me1));
    const constants = await (await fetch(base + '/api/constants')).json();
    if (constants.kabupaten?.length !== 35) fail('constants wrangler gagal');
    const pending = await fetch(base + '/api/realisasi', { headers: { authorization: 'Bearer ' + session.token } });
    if (pending.status !== 503) fail('realisasi tanpa migrasi harus 503, dapat ' + pending.status + '\n' + child.trace());

    await stop(child);
    child = startWrangler();
    await waitReady(child);
    const me2 = await fetch(base + '/api/me', { headers: { authorization: 'Bearer ' + session.token } });
    const me2Body = await me2.json();
    if (me2.status !== 200 || me2Body.user?.kode !== '3305') {
      fail('sesi hilang setelah proses baru: ' + me2.status + ' ' + JSON.stringify(me2Body) + '\n' + child.trace());
    }
    const bye = await fetch(base + '/api/logout', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + session.token },
    });
    if (bye.status !== 200) fail('logout wrangler ' + bye.status);
    const me3 = await fetch(base + '/api/me', { headers: { authorization: 'Bearer ' + session.token } });
    if (me3.status !== 401) fail('token masih berlaku setelah logout');

    const admin = await (await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: '0000', password: '0000' }),
    })).json();
    if (admin.user?.role !== 'admin') fail('admin prov gagal: ' + JSON.stringify(admin));
    const sup = await (await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: '9999', password: '9999' }),
    })).json();
    if (sup.user?.role !== 'superadmin') fail('superadmin gagal: ' + JSON.stringify(sup));
    console.log('wrangler pages dev ok');
  } finally {
    await stop(child);
  }
}

const seeded = spawnSync(process.execPath, [path.join(root, 'scripts', 'gen-users-seed.mjs')], { cwd: root, stdio: 'inherit' });
if (seeded.status !== 0) fail('seed gagal');
await unit();
await pagesDev();
console.log('smoke sesi ok');
process.exit(0);
