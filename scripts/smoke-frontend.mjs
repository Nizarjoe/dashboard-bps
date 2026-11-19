// Build, lalu cek server lokal dan proxy Pages Function tanpa mengubah data.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.SMOKE_PORT || '8299';
const base = 'http://127.0.0.1:' + port;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'build-frontend.mjs')], { cwd: root, stdio: 'inherit' });
  child.on('exit', code => code === 0 ? resolve() : reject(new Error('build exit ' + code)));
});

const distIndex = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');
if (!distIndex.includes('<meta name="api-base" content="">')) fail('API_BASE kosong tidak tersuntik');
if (!distIndex.includes("go('")) fail('navigasi hash tidak ada di dist');

const server = spawn(process.execPath, [path.join(root, 'server.js')], {
  cwd: root,
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

async function waitFor(url) {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 401) return r;
    } catch { /* server belum dengar */ }
    await new Promise(r => setTimeout(r, 80));
  }
  fail('server tidak naik di ' + url + '\n' + serverLog);
}

try {
  const home = await waitFor(base + '/');
  const html = await home.text();
  if (!html.includes('SINTA PADI')) fail('halaman depan bukan aplikasi');
  const unknown = await fetch(base + '/peta');
  const unknownHtml = await unknown.text();
  if (!unknownHtml.includes('id="app"')) fail('fallback SPA server tidak mengembalikan index');
  const login = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '3305', password: '3305' }),
  });
  const session = await login.json();
  if (!session.ok || !session.token) fail('login kabupaten gagal: ' + JSON.stringify(session));
  const me = await fetch(base + '/api/me', { headers: { authorization: 'Bearer ' + session.token } });
  const meBody = await me.json();
  if (meBody.user?.kode !== '3305') fail('sesi /api/me tidak cocok');

  const mod = await import(pathToFileURL(path.join(root, 'functions', 'api', '[[path]].js')).href);
  const missing = await mod.onRequest({ request: new Request(base + '/api/me'), env: {} });
  if (missing.status !== 401) fail('tanpa sesi harus 401, dapat ' + missing.status);
  const missingBody = await missing.json();
  if (missingBody.error?.code !== 'UNAUTHENTICATED') fail('kode sesi salah: ' + JSON.stringify(missingBody));
  const gone = await mod.onRequest({
    request: new Request('https://pages.example/api/realisasi'),
    env: { SESSIONS: { async get() { return null; } } },
  });
  if (gone.status !== 401) fail('endpoint lama tidak boleh terbuka, dapat ' + gone.status);
  console.log('smoke ok');
} finally {
  server.kill('SIGTERM');
}
