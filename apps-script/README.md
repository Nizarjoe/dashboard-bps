# Apps Script — Input Mitra SKGB 3305

Service account Google tidak punya kuota Drive pada Gmail biasa. Penulisan isian, akun, dan foto dilakukan lewat Apps Script yang berjalan sebagai pemilik spreadsheet.

## Deploy

1. Buka [script.google.com](https://script.google.com) dengan akun Google yang akan menyimpan spreadsheet dan Drive.
2. Buat proyek baru, tempel isi `Code.gs`.
3. Project Settings → Script properties → tambah `APPS_SCRIPT_SECRET` (string acak, sama dengan env Pages `APPS_SCRIPT_SECRET`).
4. Deploy → New deployment → jenis Web app.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Salin URL web app ke env Pages `APPS_SCRIPT_URL`.
6. Kosongkan `APPS_SCRIPT_URL` di preview bila akun Google belum siap. API lalu memakai KV `SESSIONS` sebagai penyimpanan sementara.

Skrip membuat spreadsheet `Input Mitra SKGB 3305` (tab `isian`, `akun`, `foto`) dan folder Drive privat `SKGB 2026/<jenis>/<id>/`.

Tanda tangan: HMAC-SHA256 atas `timestamp.nonce.stableStringify(payload)`, masa berlaku 5 menit, nonce tidak boleh diulang. Ini sama dengan `functions/lib/hmac.js`.
