# SINTA PADI — SKGB Kebumen

Dashboard untuk Kabupaten Kebumen. Halaman statis di `public/` dibangun ke `dist/`. API Pages ada di `dist/_worker.js`.

Kontrak lengkap: `docs/kontrak-api-mitra.md`. Langkah Google Apps Script: `apps-script/README.md`.

## Login

Password sama dengan ID akun. Tidak ada ubah password.

| Peran | ID | Password |
|---|---|---|
| Admin Kebumen | `3305` | `3305` |
| Mitra | `3305001` … | sama dengan ID |
| PML | `3305P01` … | sama dengan ID |

ID mitra dan PML dibentuk dari nama PCL/PML di Google Sheet. Nama di-trim, spasi ganda dipadatkan, lalu dijadikan huruf besar.

## Perintah

```bash
npm run build            # dist/ statis saja
npm run build:worker     # dist/ + dist/_worker.js
npm test                 # cek build frontend dan server Node lama
npm run test:api         # kontrak Admin/Mitra/PML
npm run test:sessions    # sama dengan test:api
```

`node server.js` masih menyalakan API provinsi yang lama di port 8200. API Pages tidak lagi memakai rute itu.

## Binding dan env

| Nama | Jenis | Kegunaan |
|---|---|---|
| `SESSIONS` | KV `3b0c0af482734b8ba8710a5f60412ae5` | sesi Bearer 7 hari, cache CSV 3 menit, salinan isian bila Apps Script kosong |
| `APPS_SCRIPT_URL` | env | URL web app Apps Script |
| `APPS_SCRIPT_SECRET` | env | rahasia HMAC. Jangan disimpan di repo |

Data sampel dibaca dari CSV publik Google Sheet, bukan dari D1. Bila `APPS_SCRIPT_URL` kosong, isian disimpan di KV supaya preview tetap bisa dicoba.

Build Pages: `npm run build:worker`. Output: `dist`.
