// Hasilkan dist/ (halaman statis) dan dist/_worker.js (API + aset).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(script) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

run('gen-users-seed.mjs');
run('build-frontend.mjs');

await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'worker', 'index.js')],
  outfile: path.join(root, 'dist', '_worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'none',
  banner: { js: '/* SINTA PADI — Pages _worker.js. Dibangun oleh npm run build:worker. */' },
});

console.log('worker bundle ok → dist/_worker.js');
