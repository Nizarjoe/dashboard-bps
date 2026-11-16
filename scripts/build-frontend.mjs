// Salin frontend statis ke dist/ dan suntik API_BASE bila diset saat build.
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const dist = path.join(root, 'dist');
const fnFile = path.join(root, 'functions', 'api', '[[path]].js');

const SECRET = /(AIza[0-9A-Za-z\-_]{20,}|sk_live_[0-9A-Za-z]+|AKIA[0-9A-Z]{16}|ghp_[0-9A-Za-z]{20,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)/;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function apiBase() {
  const raw = String(process.env.API_BASE || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  let u;
  try { u = new URL(raw); } catch { fail('API_BASE harus URL http(s) absolut atau kosong'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') fail('API_BASE hanya boleh http atau https');
  if (u.username || u.password) fail('API_BASE tidak boleh memuat userinfo');
  return raw;
}

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

const base = apiBase();
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of await walk(pub)) {
  const rel = path.relative(pub, file);
  const textish = /\.(html|js|css|txt|json)$/i.test(file) || path.basename(file).startsWith('_');
  if (textish) {
    const body = await readFile(file, 'utf8');
    if (SECRET.test(body)) fail('Pola rahasia ditemukan di ' + rel);
  }
  const dest = path.join(dist, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(file, dest);
}

const indexPath = path.join(dist, 'index.html');
let html = await readFile(indexPath, 'utf8');
if (!html.includes('<meta name="api-base" content="')) fail('index.html tidak memuat meta api-base');
const injected = base.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
html = html.replace(/<meta name="api-base" content="[^"]*">/, `<meta name="api-base" content="${injected}">`);
await writeFile(indexPath, html);

const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (inline.length !== 1) fail('index.html harus memuat tepat satu skrip inline, ketemu ' + inline.length);
const tmp = path.join(dist, '.syntax-check.js');
await writeFile(tmp, inline[0]);
const check = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
await rm(tmp, { force: true });
if (check.status !== 0) fail(check.stderr || check.stdout || 'skrip inline gagal parse');

const fnSrc = await readFile(fnFile, 'utf8');
const fnTmp = path.join(dist, '.fn-check.mjs');
await writeFile(fnTmp, fnSrc);
const fnCheck = spawnSync(process.execPath, ['--check', fnTmp], { encoding: 'utf8' });
await rm(fnTmp, { force: true });
if (fnCheck.status !== 0) fail(fnCheck.stderr || 'Pages Function gagal parse');

for (const name of ['_redirects', '_headers', '_routes.json', 'index.html', 'admin.html', 'mitra.html']) {
  try { await readFile(path.join(dist, name)); }
  catch { fail('dist/' + name + ' tidak ada'); }
}
const leaked = (await walk(dist)).some(f => f.endsWith('db.json') || f.includes(`${path.sep}uploads${path.sep}`));
if (leaked) fail('dist memuat data atau unggahan');

console.log('frontend build ok → dist/');
console.log('API_BASE=' + (base || '(kosong, same-origin)'));
