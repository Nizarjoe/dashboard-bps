# SINTA PADI — Sistem Informasi SKGB Jawa Tengah

Dashboard kabupaten/kota se-Jawa Tengah. Halaman statis di `public/` dibangun ke `dist/`. API berjalan di Cloudflare Pages lewat `dist/_worker.js`.

## Login

Password sama dengan kode. Tidak ada ubah password.

| Peran | Kode | Password |
|---|---|---|
| Kabupaten/kota | kode BPS, contoh `3305` | sama dengan kode |
| Admin provinsi | `0000` | `0000` |
| Superadmin | `9999` | `9999` |

## Perintah

```bash
npm run build          # dist/ statis saja
npm run build:worker   # dist/ + dist/_worker.js
npm test               # build frontend, server Node, proxy cadangan
npm run test:sessions  # login KV, termasuk setelah proses baru
npm run test:api       # D1, tulis/baca, kering2, unggah R2, unduh
node server.js         # API lama di port 8200 (data/db.json). Env PORT mengubah port.
```

`node server.js` tetap ada untuk pengembangan lokal. Jangan menambah berkas baru di `data/` atau `uploads/` ke git.

## Binding

| Binding | Jenis | Nilai |
|---|---|---|
| `SESSIONS` | Workers KV | `3b0c0af482734b8ba8710a5f60412ae5` (preview, sudah terpasang) |
| `DB` | D1 | nama `sinta-padi`. `database_id` di `wrangler.toml` masih placeholder |
| `UPLOADS` | R2 | bucket `sinta-padi-uploads` |

`wrangler pages dev` memakai simulasi lokal (Miniflare), bukan sumber daya remote.

R2 di akun Cloudflare biasanya meminta metode pembayaran meskipun kuotanya gratis. Bila binding `UPLOADS` tidak ada, berkas sampai 200 KB disimpan di KV `SESSIONS` dengan awalan `up:`. Berkas yang lebih besar membalas 503 dan menjelaskan bahwa R2 belum terpasang.

Cache Google Sheet (5 menit) memakai KV `SESSIONS` dengan awalan `gs:`.

## Pasang di Pages

Perintah build: `npm run build:worker`. Direktori keluaran: `dist`. Node 20.

`dist/_worker.js` adalah Pages advanced mode. Ia menangani `/api/*` dan meneruskan permintaan lain ke `env.ASSETS` (termasuk fallback SPA di `_redirects`). Folder `functions/` diabaikan selama `_worker.js` ada di keluaran.

1. Buat database: `npx wrangler d1 create sinta-padi`. Salin `database_id` ke `wrangler.toml` (binding `DB`).
2. Terapkan skema ke remote: `npx wrangler d1 migrations apply sinta-padi --remote`.
3. Impor data yang sudah ada:

```bash
node scripts/import-db-sql.mjs data/db.json > /tmp/sinta-padi.sql
npx wrangler d1 execute sinta-padi --remote --file /tmp/sinta-padi.sql
```

Impor mengosongkan `users`, `target`, dan `sheet_row`, lalu mengisi ulang. Metadata unggahan tidak dihapus. Jangan meng-commit berkas SQL itu.

4. Buat bucket R2 `sinta-padi-uploads` bila akun mengizinkan, lalu pasang binding `UPLOADS`.
5. Di Pages → Settings → Bindings, pasang `SESSIONS`, `DB`, dan `UPLOADS` pada production dan preview. Nama binding harus persis.
6. Unggah isi `dist/` (termasuk `_worker.js`).

Lokal:

```bash
npx wrangler d1 migrations apply sinta-padi --local
node scripts/import-db-sql.mjs data/db.json > /tmp/sinta-padi.sql
npx wrangler d1 execute sinta-padi --local --file /tmp/sinta-padi.sql
npx wrangler pages dev dist
```

Bila binding `SESSIONS` tidak ada, `/api/*` diteruskan ke `API_ORIGIN` (server Node). Tanpa keduanya, responsnya 503.

## Sesi

Token Bearer 48 karakter hex, kunci KV `sess:…`, TTL 7 hari. Token yang sama tetap berlaku setelah proses atau deploy baru, sampai logout atau TTL habis. Logout di halaman memanggil `POST /api/logout`.

Pengguna dibaca dari tabel D1 `users` bila tabel itu berisi data. Bila tabel belum ada atau masih kosong, login memakai seed statis yang dihasilkan dari daftar di `server.js` (`npm run seed`).

## Peta dan pengeringan tahap 2

`GET /api/realisasi` tetap mengembalikan `tK`, `rK`, `tK2`, `rK2`, `tG`, `rG`. `tK2` sama dengan realisasi tahap 2, mengikuti `server.js`. Tiap baris kini juga punya `ku` dan `kc`: jumlah sampel kering eligible utama dan cadangan di kabupaten itu (pola id `C` + angka, sama seperti KPI). Peta memakai kedua angka itu. Parameter `?kab=3305` mempersempit baris dan total; UI peta belum punya dropdown filter.

Kunjungan pengeringan ke-2 menulis dan membaca `/api/sheet/kering2`, terpisah dari `kering1`. Bentuk isiannya sama. Halaman anomali kering tetap membaca `kering1`.
