# Kontrak API CRUD + Koreksi PML (dashboard-bps)

Untuk: GIBRAN (frontend). Dari: SITI (backend). Branch: `siti/monitoring-katalog-v2`.
Contoh memakai data SINTETIS. Kontrak monitoring (baca-saja) tetap di `kontrak-monitoring-v2.md`.

## 1. Audit CRUD per fitur

Simbol: ✓ ada sebelumnya, ➕ ditambahkan sekarang, – tidak ada dan memang tidak boleh ada.

| Fitur / entitas | Disimpan di | C | R | U | D | Siapa boleh | Catatan |
|---|---|---|---|---|---|---|---|
| Sampel SKGB (alokasi pengeringan/penggilingan) | Sheet SKGB milik pihak lain | – | ✓ | – | – | R: admin semua, PML sampel bimbingan, mitra sampel miliknya | BACA-SAJA. Tidak boleh CRUD. |
| Opsi (status sampel, hasil pencacahan) | Turunan sheet SKGB | – | ✓ | – | – | semua peran | BACA-SAJA. |
| Isian sampel | Apps Script, tab `isian` (append-only, berversi) | ✓ simpan/kirim | ✓ | ✓ versi baru | ➕ hapus lunak, ➕ pulihkan (admin) | Mitra: sampel miliknya; ubah saat belum dikirim, hapus hanya draf/ditolak. PML: baca saja (NIK disamarkan). Admin: semua. | Hapus = versi baru `aksi:hapus`, `status:belum`. Riwayat lama tetap. |
| Tolak isian | Apps Script `isian` | ✓ | – | – | – | admin | Sudah ada. |
| Foto sampel | Apps Script + Drive | ✓ unggah | ✓ | ✓ unggah ulang | ➕ hapus lunak, ➕ pulihkan (admin) | Mitra: miliknya, selama belum terkunci. PML: lihat saja (tanpa KTP). Admin: semua. | Berkas Drive tidak dihapus. Penanda hapus disimpan di APPDB. |
| Akun | Apps Script tab `akun`, dibuat otomatis dari sheet SKGB | ✓ otomatis | ✓ daftar, ➕ satu | ➕ `aktif` saja | ➕ hapus lunak = nonaktif | admin | Nama, peran, dan PML ikut sheet sumber. Password = ID dan tidak bisa diubah. Admin 3305 terkunci. |
| Sesi login | KV | ✓ login | ✓ `/api/me` | – | ✓ logout | pemilik sesi | Lengkap. Akun nonaktif langsung ditolak (401 `AKUN_NONAKTIF`). |
| Koreksi PML → mitra | APPDB (D1 baru) | ➕ | ➕ | ➕ | ➕ batal (PML) / hapus lunak (admin) | lihat §3 | Fitur baru. |
| Jejak audit | APPDB | otomatis | ➕ admin | – | – | admin baca | Tidak boleh diubah atau dihapus. |
| Monitoring (katalog, tab, ringkasan) | Google Sites + sheet pihak lain | – | ✓ | – | – | admin penuh, PML disamarkan, mitra 403 | BACA-SAJA. Katalog diubah lewat repo (`npm run sync:katalog`). |
| Dashboard admin/PML, ekspor CSV | Turunan | – | ✓ | – | – | admin / PML | Baca-saja. |
| Menu Monitoring GC | – | – | – | – | – | – | Tetap tersembunyi. |

Hak akses ditegakkan di server: mitra hanya data miliknya, PML hanya mitra/sampel bimbingannya, admin semua.
PML tetap ditolak (403) untuk semua PUT/POST/PATCH/DELETE kecuali `/api/koreksi*` dan logout.

## 2. Endpoint CRUD baru (sampel, foto, akun, audit)

### DELETE /api/sampel/{jenis}/{id}/isian
Body: `{ "versi": number, "alasan"?: string ≤300 }` (`versi` = versi isian sekarang).
- Mitra pemilik: hanya bila status `draf` atau `ditolak`. Bila sudah dikirim: 409 `LOCKED`.
- Admin: status apa pun. PML: 403.
- 200: `{ "status": "belum", "versi": 3, "dihapus": true, "updatedAt": "…" }`
- Galat: 404 (sampel tidak ada / belum ada isian), 403, 409 `CONFLICT` (versi basi), 409 `LOCKED`.

### POST /api/admin/sampel/{jenis}/{id}/isian/pulihkan (admin)
Body: `{ "versi": number }` (versi "hapus" terakhir). Memulihkan isian versi sebelum hapus sebagai versi baru.
- 200: `{ "status": "draf", "versi": 4, "locked": false, "updatedAt": "…" }`
- 409 `STATUS_TIDAK_SESUAI` bila isian terakhir bukan hasil hapus.

### DELETE /api/sampel/{jenis}/{id}/foto/{slot}
Body opsional: `{ "alasan"?: string }`. Mitra pemilik (belum terkunci) atau admin. PML 403.
- 200: `{ "slot": "ktp", "dihapus": true, "terisi": false, "url": null, "fotoTerisi": 3 }`.
  `terisi` bisa tetap `true` bila sheet SKGB punya tautan foto untuk slot itu (tautan sheet tidak bisa dihapus).
- 404 bila slot tidak punya unggahan. 503 `FITUR_BELUM_AKTIF` bila APPDB belum terpasang.
- Sesudah hapus, `GET /api/foto/...` membalas 404 dan detail/daftar tidak menghitung foto itu. Unggahan baru tampil lagi seperti biasa.

### POST /api/admin/sampel/{jenis}/{id}/foto/{slot}/pulihkan (admin)
200 `{ "slot": "ktp", "dipulihkan": true }`. 404 bila tidak ada foto terhapus.

### GET / PATCH / DELETE /api/admin/akun/{id} (admin)
- GET: satu akun, bentuk sama dengan item `/api/admin/akun`.
- PATCH body: `{ "aktif": boolean, "alasan"?: string }`. Field lain → 422 `VALIDATION` (`fields.lain`).
- DELETE body opsional `{ "alasan" }` = nonaktifkan (lunak). Aktifkan lagi dengan PATCH `aktif:true`.
- 409 `AKUN_TERKUNCI` untuk 3305. 503 `FITUR_BELUM_AKTIF` tanpa APPDB (audit wajib).
- Akun nonaktif: login 401, sesi lama 401 `AKUN_NONAKTIF`, dan tidak bisa menerima koreksi baru (422 `MITRA_NONAKTIF`).

### GET /api/admin/audit?entitas=akun|foto|isian&id=&limit= (admin)
```json
{ "data": [{ "id": 7, "waktu": "…", "oleh": "3305", "peran": "admin", "entitas": "akun", "entitasId": "3305003", "aksi": "nonaktifkan", "data": { "alasan": "kontrak selesai" } }], "meta": { "total": 1 } }
```

### Perubahan pada GET /api/sampel/{jenis}/{id}
`riwayat` kini dikirim untuk semua peran yang boleh membaca sampel (sebelumnya hanya admin): `[{ versi, oleh:{id,nama}, aksi:'simpan'|'kirim'|'tolak'|'hapus'|'pulihkan', waktu }]`. Nilai isian lama tidak ikut.

## 3. Koreksi

### Tipe
```ts
type StatusKoreksi = 'terkirim' | 'dibaca' | 'ditanggapi' | 'diperbaiki' | 'ditutup' | 'dibatalkan';

interface Koreksi {
  id: string;                        // "K" + 16 hex
  tipe: 'sampel' | 'monitoring';
  rujukan: { jenis: 'pengeringan' | 'penggilingan'; id: string }        // tipe sampel
         | { tabId: string; baris: string; label: string };             // tipe monitoring
  bagian: string;                    // opsional, ≤60, mis. "isian.nik", "foto.ka_1"
  catatan: string;                   // 1..1000
  status: StatusKoreksi;
  tanggapan: string;                 // dari mitra
  mitra: { id: string; nama: string };
  pml: { id: string; nama: string };
  versi: number;                     // naik tiap perubahan; kirim balik untuk cegah tabrakan
  dibuat: string; diubah: string;
  dibacaAt: string | null; ditanggapiAt: string | null;
  ditutupAt: string | null;          // hanya terisi saat status ditutup; dikosongkan jika dibuka lagi
  dibatalkanAt: string | null;       // hanya terisi saat status dibatalkan; BUKAN ditutupAt
  dihapus?: true; dihapusAt?: string; // hanya terlihat admin
}
```

### Alur status
```
            PML buat / ubah
                 │
                 ▼
  ┌────────► terkirim ──(mitra baca)──► dibaca
  │              │  ▲                     │
  │  PML batal   │  └──(PML ubah)─────────┘
  │  (terkirim/  ▼
  │   dibaca) dibatalkan [final]
  │
  │   mitra tanggapi (diperbaiki=false) ─► ditanggapi
  │   mitra tanggapi (diperbaiki=true)  ─► diperbaiki
  │        (dari terkirim/dibaca/ditanggapi/diperbaiki)
  │
  └── PML buka lagi (wajib catatan) ◄── ditanggapi / diperbaiki / ditutup
      PML atau admin tutup (dari status non-final) ─► ditutup
```
- PML boleh **ubah** dan **batal** hanya saat `terkirim` atau `dibaca` (belum ditanggapi). Mengubah koreksi yang sudah dibaca mengembalikannya ke `terkirim`. Membatalkan mengisi `dibatalkanAt` dan membiarkan `ditutupAt` kosong.
- Mitra boleh **tandai dibaca** (idempoten) dan **menanggapi** selama status belum final.
- PML boleh **tutup** dan **buka lagi**. Admin boleh **tutup**, **hapus lunak**, dan **pulihkan**.
- Visibilitas: mitra hanya koreksi untuk dirinya, PML hanya koreksi yang ia kirim, admin semua. Selain itu **404** (keberadaan tidak dibocorkan). Koreksi terhapus hanya terlihat admin.
- Semua langkah tercatat di `riwayat` (tabel `koreksi_log`).

### Endpoint
| Metode & path | Peran | Body | Hasil |
|---|---|---|---|
| `GET /api/koreksi?status=&mitra=&pml=&jenis=&sampel=&tab=&aktif=1&termasukDihapus=1` | semua (tercakup) | – | `{data: Koreksi[], meta:{total, jumlah:{<status>:n}, belumDibaca}}`; `pml` & `termasukDihapus` khusus admin |
| `POST /api/koreksi` | PML | `{rujukan, bagian?, catatan}` | 201 `Koreksi` |
| `GET /api/koreksi/{id}` | tercakup | – | `Koreksi & {riwayat:[{waktu, oleh:{id,nama}, peran, aksi, dari, ke, catatan}]}` |
| `PATCH /api/koreksi/{id}` | PML pengirim | `{catatan?, bagian?, versi?}` | `Koreksi` (status → `terkirim`) |
| `DELETE /api/koreksi/{id}` | PML pengirim: batal; admin: hapus lunak | `{alasan?, versi?}` | `Koreksi` |
| `POST /api/koreksi/{id}/baca` | mitra tujuan | – | `Koreksi` |
| `POST /api/koreksi/{id}/tanggapi` | mitra tujuan | `{tanggapan, diperbaiki?: boolean, versi?}` | `Koreksi` |
| `POST /api/koreksi/{id}/tutup` | PML pengirim, admin | `{catatan?, versi?}` | `Koreksi` |
| `POST /api/koreksi/{id}/buka` | PML pengirim | `{catatan, versi?}` | `Koreksi` |
| `POST /api/koreksi/{id}/pulihkan` | admin | – | `Koreksi` |

`rujukan` saat membuat:
- Sampel: `{ "jenis": "pengeringan", "id": "S-003" }`. Sampel harus bimbingan PML; mitra tujuan diambil dari sampel.
- Monitoring: `{ "tipe": "monitoring", "tabId": "tp-…", "baris": "KODE-UJI-01", "mitraId": "3305001" }`. Mitra harus bimbingan PML (`pml_id`). Isi `baris` dengan `kunciBaris[i]` dari `GET /api/monitoring/tab` (lihat `kontrak-monitoring-v2.md`), **bukan** nama, NIK, atau nomor baris yang diketik manual.

Contoh:
```http
POST /api/koreksi
{ "rujukan": { "jenis": "pengeringan", "id": "S-003" }, "bagian": "foto.ka_1", "catatan": "Foto kadar air amatan 1 buram, mohon unggah ulang." }

201
{ "id": "K35cfe164243ee0d0", "tipe": "sampel", "rujukan": { "jenis": "pengeringan", "id": "S-003" }, "bagian": "foto.ka_1",
  "catatan": "Foto kadar air amatan 1 buram, mohon unggah ulang.", "status": "terkirim", "tanggapan": "",
  "mitra": { "id": "3305001", "nama": "MITRA DUA" }, "pml": { "id": "3305P02", "nama": "PENGAWAS SATU" },
  "versi": 1, "dibuat": "2026-11-27T04:15:17.442Z", "diubah": "2026-11-27T04:15:17.442Z",
  "dibacaAt": null, "ditanggapiAt": null, "ditutupAt": null, "dibatalkanAt": null }
```
```http
POST /api/koreksi/K35cfe164243ee0d0/tanggapi
{ "tanggapan": "Sudah saya unggah ulang.", "diperbaiki": true, "versi": 2 }
```

## 4. Kode galat baru / yang dipakai

| Kode | HTTP | Kapan |
|---|---|---|
| `FITUR_BELUM_AKTIF` | 503 | APPDB belum terpasang (produksi saat ini): koreksi, hapus/pulihkan foto, ubah akun, audit |
| `STATUS_TIDAK_SESUAI` | 409 | aksi tidak sah untuk status sekarang; `fields.status` berisi status sekarang |
| `CONFLICT` | 409 | `versi` yang dikirim sudah basi |
| `LOCKED` | 409 | mitra mengubah/menghapus isian atau foto yang sudah dikirim |
| `MITRA_TIDAK_TERHUBUNG` | 422 | sampel belum terhubung ke akun mitra |
| `MITRA_NONAKTIF` | 422 | mitra tujuan nonaktif |
| `AKUN_TERKUNCI` | 409 | mengubah akun admin utama |
| `AKUN_NONAKTIF` | 401 | sesi milik akun yang dinonaktifkan |
| `VALIDATION` | 422 / 400 | isian tidak valid (`fields`) |
| `FORBIDDEN` | 403 | peran tidak berhak (mis. PML menulis selain koreksi, mitra membuat koreksi) |
| `NOT_FOUND` | 404 | tidak ada, atau di luar cakupan (koreksi milik orang lain) |
| `METHOD_NOT_ALLOWED` | 405 | metode salah di `/api/koreksi*` |

## 5. Penyimpanan

- Koreksi, audit, dan penanda hapus foto ada di **D1 baru, binding `APPDB`**, skema `migrations-app/0001_koreksi_audit.sql` dan `migrations-app/0002_dibatalkan_at.sql` (`dibatalkan_at` terpisah dari `ditutup_at`). Database ini terpisah dari D1 `DB` lama (a5eb0932), yang tidak disentuh.
- Preview: `APPDB` = `dashboard-bps-preview` (khusus env preview).
- Produksi: belum ada `APPDB`, jadi endpoint di atas membalas 503 `FITUR_BELUM_AKTIF` sampai disetujui.
- Isian dan akun tetap ditulis lewat Apps Script dengan operasi yang sudah ada (`appendIsian`, `upsertAkun`). Tidak ada perubahan Apps Script.

## 6. Saran UI (bukan kontrak)

- Mitra: lencana jumlah `meta.belumDibaca`, daftar koreksi per sampel (`?jenis=&sampel=`), tombol "Tandai dibaca", "Tanggapi", dan "Sudah diperbaiki".
- PML: tombol "Kirim koreksi" di detail sampel bimbingan. Tampilkan "Ubah/Batalkan" hanya saat status `terkirim`/`dibaca`, lalu "Tutup/Buka lagi".
- Admin: daftar semua koreksi dengan filter PML/mitra/status, plus halaman audit.
- Kirim `versi` pada setiap aksi agar tabrakan antarpengguna terdeteksi (409 `CONFLICT` → muat ulang).
