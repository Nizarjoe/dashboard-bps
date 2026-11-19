// Naikkan skema 0001 lama yang sudah berisi data ke 0002, hanya di D1 lokal.
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const persist = path.join(root, '.wrangler', 'smoke-migration');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function wrangler(args, { allowFail = false } = {}) {
  const r = spawnSync('npx', ['wrangler', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.status !== 0) {
    const text = (r.stdout || '') + (r.stderr || '');
    if (allowFail) {
      const err = new Error(text);
      err.status = r.status;
      throw err;
    }
    fail(text + '\nwrangler gagal: ' + args.join(' '));
  }
  return r.stdout || '';
}

function query(sql) {
  const out = wrangler(['d1', 'execute', 'sinta-padi', '--local', '--persist-to', persist, '--json', '--command', sql]);
  const parsed = JSON.parse(out);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first.results || [];
}

await rm(persist, { recursive: true, force: true });
wrangler(['d1', 'execute', 'sinta-padi', '--local', '--persist-to', persist, '--file', path.join(root, 'migrations', '0001_init.sql')]);

const tmp = await mkdtemp(path.join(tmpdir(), 'sinta-mig-'));
const seed = path.join(tmp, 'seed.sql');
await writeFile(seed, `
INSERT INTO users (kode, password, nama, role) VALUES ('3305', '3305', 'KEBUMEN', 'kab');
INSERT INTO target (kode, jenis, t, r) VALUES ('3305', 'kering', 10, 4);
INSERT INTO upload (key, mime, size, kode, backend, dibuat) VALUES ('berkas_a', 'image/png', 12, '3305', 'r2', 1);
INSERT INTO sheet_row (id, sheet, kab, row_key, jenis, status, cadangan, hasil, petak, pemanen, data) VALUES
  (1, 'utker', '3305', 'U1', 'Utama', 'Eligible', 0, '', '', '', '{"id":"U1"}'),
  (2, 'utker', '3305', 'C1', '', 'Eligible', 1, '', '', '', '{"id":"C1"}'),
  (7, 'utker', '3301', 'U2', 'Cadangan', 'Eligible', 0, '', '', '', '{"id":"U2"}');
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO d1_migrations (name) VALUES ('0001_init.sql');
`);
wrangler(['d1', 'execute', 'sinta-padi', '--local', '--persist-to', persist, '--file', seed]);

const before = query("SELECT id, kab, row_key, jenis, cadangan, data FROM sheet_row ORDER BY id");
if (before.length !== 3 || before[2].id !== 7 || Number(before[2].cadangan) !== 0) {
  fail('data awal 0001 tidak tersimpan: ' + JSON.stringify(before));
}
let rejected = false;
try {
  wrangler(['d1', 'execute', 'sinta-padi', '--local', '--persist-to', persist, '--command',
    "INSERT INTO sheet_row (sheet, kab, row_key, jenis, status, cadangan, hasil, petak, pemanen, data) VALUES ('x', '3305', 'N', '', '', NULL, '', '', '', '{}')"], { allowFail: true });
} catch {
  rejected = true;
}
if (!rejected) fail('skema 0001 lama harus menolak cadangan NULL');

const applied = wrangler(['d1', 'migrations', 'apply', 'sinta-padi', '--local', '--persist-to', persist]);
if (!applied.includes('0002_cadangan_nullable.sql')) fail('0002 tidak diterapkan:\n' + applied);
if ((applied.match(/0001_init\.sql/g) || []).length > 0 && applied.includes('Applying 0001')) {
  fail('0001 tidak boleh dijalankan ulang:\n' + applied);
}

const after = query("SELECT id, kab, row_key, jenis, cadangan, data FROM sheet_row WHERE row_key IN ('U1','C1','U2') ORDER BY id");
if (JSON.stringify(after) !== JSON.stringify(before)) {
  fail('data berubah sesudah 0002\nsebelum ' + JSON.stringify(before) + '\nsesudah ' + JSON.stringify(after));
}
const info = query('PRAGMA table_info(sheet_row)');
const col = info.find(c => c.name === 'cadangan');
if (!col || Number(col.notnull) !== 0) fail('cadangan masih NOT NULL: ' + JSON.stringify(col));
query("INSERT INTO sheet_row (sheet, kab, row_key, jenis, status, hasil, petak, pemanen, data) VALUES ('utker', '3305', 'KOSONG', 'Cadangan', 'Eligible', '', '', '', '{\"id\":\"KOSONG\"}')");
const kosong = query("SELECT id, cadangan, jenis FROM sheet_row WHERE row_key = 'KOSONG'");
if (kosong.length !== 1 || kosong[0].cadangan != null || Number(kosong[0].id) !== 8) {
  fail('baris baru harus id 8 dan cadangan NULL: ' + JSON.stringify(kosong));
}
const indexes = query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sheet_row'").map(r => r.name).sort();
for (const name of ['idx_sheet_kab', 'idx_sheet_key', 'idx_sheet_status']) {
  if (!indexes.includes(name)) fail('index hilang: ' + indexes.join(','));
}
const user = query("SELECT kode, nama FROM users");
const target = query("SELECT t, r FROM target WHERE kode = '3305'");
const upload = query("SELECT key, size FROM upload");
if (user.length !== 1 || user[0].nama !== 'KEBUMEN' || Number(target[0].t) !== 10 || upload[0].key !== 'berkas_a') {
  fail('tabel lain berubah');
}
const journal = query('SELECT name FROM d1_migrations ORDER BY id').map(r => r.name);
if (!journal.includes('0001_init.sql') || !journal.includes('0002_cadangan_nullable.sql')) {
  fail('jurnal migrasi: ' + journal.join(','));
}
console.log('migrasi 0001 -> 0002 ok');
