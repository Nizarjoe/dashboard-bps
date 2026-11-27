# Apps Script — Input Mitra SKGB 3305

Service account Google tidak punya kuota Drive pada Gmail biasa. Penulisan isian, akun, dan foto dilakukan lewat Apps Script yang berjalan sebagai pemilik spreadsheet.

## Deploy

1. Buka [script.google.com](https://script.google.com) dengan akun Google yang akan menyimpan spreadsheet dan Drive.
2. Buat proyek baru, tempel isi `Code.gs`.
3. Project Settings → Script properties → tambah `APPS_SCRIPT_SECRET` (string acak, sama dengan env Pages `APPS_SCRIPT_SECRET`).
4. Di editor, pilih fungsi `setup` lalu Run. Fungsi itu membuat atau menemukan spreadsheet `Input Mitra SKGB 3305` dan folder `SKGB 2026`, lalu menyimpan `SPREADSHEET_ID` dan `FOLDER_ID` di Script properties. Pencarian hanya memakai spreadsheet dan folder yang tidak ada di sampah, jadi file lain dengan nama yang sama tidak terpilih.
5. Deploy → New deployment → jenis Web app.
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Salin URL web app ke env Pages `APPS_SCRIPT_URL`.
7. Kosongkan `APPS_SCRIPT_URL` di preview bila akun Google belum siap. API lalu memakai KV `SESSIONS` sebagai penyimpanan sementara.

Skrip menulis tab `isian`, `akun`, dan `foto`. Foto disimpan sebagai file privat di `SKGB 2026/<jenis>/<id>/`. Penulisan baris memakai `LockService.getScriptLock()` paling lama 10 detik. `uploadFoto_` membuka spreadsheet lebih dulu, baru membuat file, supaya kegagalan sheet tidak meninggalkan file tanpa indeks.

Operasi: `listIsian`, `appendIsian`, `listAkun`, `upsertAkun`, `listFoto`, `listFotoAll`, `uploadFoto`, `getFoto`. `listFoto` membaca riwayat satu sampel. `listFotoAll` membaca tab `foto` sekali dan mengembalikan slot terbaru per `(jenis, id)` tanpa byte file. Tanda tangan HMAC untuk semua operasi sama.

Tanda tangan: HMAC-SHA256 atas `timestamp.nonce.stableStringify(payload)`, masa berlaku 5 menit, nonce tidak boleh diulang. Ini sama dengan `functions/lib/hmac.js`.

Setelah menempel `Code.gs` yang baru, deploy versi web app yang baru. URL lama tetap menunjuk deployment sebelumnya sampai versi baru dipilih.
