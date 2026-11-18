# SINTA PADI — Sistem Informasi SKGB Jawa Tengah

Dashboard kabupaten/kota se-Jawa Tengah. Frontend statis di `public/` (hasil build di `dist/`). API berjalan di Cloudflare Pages lewat `dist/_worker.js`, dengan sesi di KV.

## Login

Password sama dengan kode pengguna. Tidak ada ubah password.

| Peran | Kode | Password |
|---|---|---|
| Kabupaten/kota | kode BPS, contoh `3305` | sama dengan kode |
| Admin provinsi | `0000` | `0000` |
| Superadmin | `9999` | `9999` |

## Perintah

```bash
npm run build          # dist/ statis saja
npm run build:worker   # dist/ + dist/_worker.js (API dan halaman)
npm test               # build frontend + server Node + proxy cadangan
npm run test:sessions  # login KV lewat wrangler pages dev, termasuk restart proses
```

`node server.js` (port 8200, ubah lewat `PORT`) masih melayani data dari `data/db.json` untuk pengembangan lokal. Jangan unggah `data/` atau `uploads/`.

## Cloudflare

Sumber daya yang dipakai milestone sesi:

| Binding | Jenis | ID |
|---|---|---|
| `SESSIONS` | KV | `3b0c0af482734b8ba8710a5f60412ae5` (preview, sudah terpasang) |

Buat atau samakan binding production dengan nama **`SESSIONS`**. `wrangler pages dev` memakai KV lokal (Miniflare), bukan namespace remote.

Langkah unggah advanced mode (satu berkas `_worker.js`, tanpa `wrangler login`):

1. `npm run build:worker`
2. Unggah isi `dist/` sebagai output Pages. Berkas `dist/_worker.js` mengambil alih semua permintaan. `/api/*` ditangani skrip itu. Selain itu diteruskan ke aset statis (`env.ASSETS`), termasuk fallback SPA di `_redirects`.
3. Di Pages → Settings → Bindings, pasang KV `SESSIONS` pada production dan preview.
4. Perintah build di Git, bila dipakai: `npm run build:worker`. Direktori output: `dist`.

Bila binding `SESSIONS` tidak ada, `/api/*` kembali diteruskan ke variabel `API_ORIGIN` (server Node). Tanpa keduanya, responsnya 503.

Sesi disimpan di KV dengan kunci `sess:` + token Bearer (48 karakter hex) dan TTL 7 hari. Token yang sama tetap berlaku setelah proses atau deploy baru, sampai logout atau TTL habis. Logout frontend memanggil `POST /api/logout`.

`GET /api/constants` ikut tersedia karena layar pertama membutuhkannya dan datanya statis. Rute data lain yang ada di `server.js` membalas **501** dengan pesan `Endpoint ini belum dipindahkan ke Cloudflare Pages.` sampai pemindahan D1 selesai.

## Rute sesi

| Metode | Path | Auth | Hasil |
|---|---|---|---|
| POST | `/api/login` | tidak | `{ok, token, user}` atau 401 |
| GET | `/api/me` | Bearer | `{user}` atau 401 `Belum login` |
| POST atau DELETE | `/api/logout` | Bearer | `{ok:true}` lalu token dihapus dari KV |
| GET | `/api/constants` | tidak | daftar kabupaten dan pilihan formulir |
