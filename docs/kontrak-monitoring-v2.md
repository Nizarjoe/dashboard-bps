# Kontrak API Monitoring v2 (dashboard-bps)

Untuk: GIBRAN (frontend). Dari: SITI (backend). Branch: `siti/monitoring-katalog-v2`.
Semua contoh memakai data SINTETIS. Tidak ada data pribadi di dokumen ini.
CRUD dan koreksi PML ada di `kontrak-crud-koreksi.md`. Monitoring tetap BACA-SAJA (tidak ada POST/PUT/PATCH/DELETE).

## Ringkas

| Endpoint | Metode | Admin | PML | Mitra |
|---|---|---|---|---|
| `/api/monitoring/katalog` | GET | ya | ya | 403 |
| `/api/monitoring/tab` | GET | data penuh | data DISAMARKAN server | 403 |
| `/api/monitoring/ringkasan` | GET | ya | ya (agregat) | 403 |
| `/api/gsheets` (kompat) | GET | ya | ya | 403 |
| `/api/gsheet` (kompat) | GET | sama dengan `/api/monitoring/tab` | disamarkan | 403 |

Semua butuh `Authorization: Bearer <token>`. Tanpa token: 401 seperti endpoint lain.
Sumber data dibaca langsung dari Google Sheet publik (tanpa salin ke D1), cache 5 menit.

## Tipe

```ts
type Bidang = 'tp' | 'inpek' | 'horti';

interface Tautan {
  jenis: 'form' | 'drive' | 'lain';
  label: string;          // teks tombol di Google Sites
  url: string;            // http(s), host Google/BPS saja
  perluCek: boolean;      // true = terakhir dicek 404/500, tampilkan peringatan
}

interface TabKatalog {
  id: string;             // stabil, mis. "tp-1IzurELQ-0"
  bidang: Bidang;
  survei: string;         // pengelompokan, mis. "KSA 2026 Amatan November"
  periode: string | null; // "SR 3", "TW 2", "Amatan Oktober"
  jenis: string | null;   // "Padi", "Pemutakhiran", ...
  tahun: number;
  arsip: boolean;         // tahun < 2026
  label: string;
  sid: string;
  gid: string;
  tersedia: boolean;      // false = dilewati, Google TIDAK dipanggil
  alasan: { kode: 'SHEET_FORMAT_UNSUPPORTED' | 'SHEET_REMOVED'; pesan: string } | null;
  headerRow: number | null; // 1-based, dari katalog
  ringkasan: boolean;     // punya pemetaan ringkasan (12 tab TP 2026)
  tautan: Tautan[];       // form upload / folder drive / bahan ajar per tab
}

interface Galat {
  error: {
    code: string;
    message: string;      // Bahasa Indonesia, layak tampil ke pengguna
    retryable?: boolean;  // selalu ada pada galat monitoring
    sumber?: { id: string; label: string };
    fields?: Record<string, unknown>;
  }
}
```

## GET /api/monitoring/katalog

Query: `bidang=tp|inpek|horti` (opsional), `arsip=1` (opsional; default arsip DISEMBUNYIKAN).

```json
{
  "data": [
    {
      "id": "tp-1IzurELQ-0", "bidang": "tp", "survei": "KSA 2026 Amatan November",
      "periode": "Amatan November", "jenis": "Padi", "tahun": 2026, "arsip": false,
      "label": "Monitoring KSA Padi (Amatan November)", "sid": "1Izur…", "gid": "0",
      "tersedia": true, "alasan": null, "headerRow": 2, "ringkasan": true,
      "tautan": [{ "jenis": "form", "label": "Upload Foto KSA", "url": "https://docs.google.com/forms/…", "perluCek": false }]
    }
  ],
  "meta": { "total": 43, "tersedia": 35, "arsipDitampilkan": false, "versi": 2, "diperbarui": "2026-11-27", "sumber": "https://sites.google.com/view/monitoringproduksi3305" }
}
```

Jumlah: 70 tab total, 43 aktif (default), 27 arsip, 11 `tersedia:false`.
Galat: 400 `VALIDATION` (bidang tak dikenal), 403 `FORBIDDEN` (mitra).

## GET /api/monitoring/tab

Query: `id=<id>` ATAU `sid=<sid>&gid=<gid>`.

```json
{
  "id": "tp-…", "label": "…", "bidang": "tp", "survei": "…", "tahun": 2026, "arsip": false,
  "tautan": [],
  "headerRow": 3,
  "header": ["No.", "Kode Identitas", "Nama Responden", "NIK", "No HP", "Email PCL", "Alamat", "PCL", "PML", "Hasil Pencacahan", ""],
  "rows": [["DATA SINTETIS UNTUK UJI"], ["Rekap…"], ["No.", "Kode Identitas", "…"],
           ["1", "1234567890123456", "Contoh S. D.", "9900********0001", "*********001", "***@example.test", "[disamarkan]", "Petugas Uji A", "Pengawas Uji A", "1. Berhasil", "[disamarkan]"]],
  "kunci": { "kolom": "Kode Identitas", "indeks": 1, "sumber": "pemetaan" },
  "kunciBaris": [null, null, null, "1234567890123456"],
  "meta": {
    "syncedAt": "2026-11-27T05:00:00.000Z",
    "changedAt": "2026-11-27T04:10:00.000Z",
    "stale": false,
    "disamarkan": true,
    "kolomDisamarkan": [{ "indeks": 2, "kolom": "Nama Responden", "jenis": "singkat" }, { "indeks": 3, "kolom": "NIK", "jenis": "nik" }],
    "selDisamarkanPola": 1
  }
}
```

- `rows` = matriks mentah (termasuk baris judul di atas header), sama seperti v1. Data mulai `rows[headerRow]`.
- `header` = `rows[headerRow-1]`. Pakai ini, jangan lagi `rows[0]`.
- `kunciBaris` sejajar dengan `rows` (indeks sama). Baris judul dan header bernilai `null`. Kunci dihitung dari data mentah **sebelum** disamarkan, jadi admin dan PML mendapat nilai yang sama.
- `kunci.sumber = "pemetaan"`: nilai diambil dari kolom kunci pemetaan ringkasan tab itu (`kunci.kolom`, `kunci.indeks` 0-based). Kolom resmi yang terpetakan saat ini: `ID Sub Segmen`, `Kode Identitas`, `NKS`, `idsubsegmen`, `ID SBR`, atau `NO.` — **bukan** nama atau NIK.
- Bila tab belum dipetakan, kolom kunci tidak ada di header, atau sel kuncinya kosong: `kunci.sumber = "baris+hash"` dan nilainya `r{n}:{hash8}` (`n` = nomor 1-based di `rows`, `hash8` = FNV-1a 32-bit heksadesimal dari isi baris).
- Nilai kolom yang dobel di tab yang sama: kemunculan kedua dan seterusnya mendapat akhiran `#r{n}`.
- Pakai `kunciBaris[i]` sebagai `rujukan.baris` saat PML mengirim koreksi monitoring. Jangan ketik manual.
- `meta.stale=true` + `meta.error {code,message}` = Google gagal, yang tampil salinan terakhir.
- `meta.syncedAt` = terakhir dicek ke Google; `meta.changedAt` = terakhir isinya berubah.
- Admin: `disamarkan:false`, tanpa `kolomDisamarkan`.

### Aturan penyamaran PML (server)

| Jenis | Kolom (dari nama header) | Hasil |
|---|---|---|
| `nik` | NIK, No KTP | 4 digit awal + `*` + 4 digit akhir |
| `penuh` | kolom berisi "KTP" (foto KTP, KTP sampel), alamat, RT/RW, koordinat, latitude/longitude, gmaps, lokasi, dusun, kolom TANPA header | `[disamarkan]` |
| `telp` | telp/telepon/HP/WA/kontak | `*` + 3 digit akhir |
| `email` | email | `***@domain` |
| `singkat` | nama responden, nama KK/KRT/ruta/kepala RT, pengelola, pengusaha, narahubung, nama usaha/perusahaan, UTP/UTL/UPB, cek ruta, kolom "Nama" polos | kata pertama + inisial ("Contoh S. D."), satu kata jadi "C***" |
| pola sel | semua sel lain | angka 16 digit (kecuali kolom kode/ID), nomor HP 08…/62…, email disamarkan di dalam teks |

Dibiarkan: nama petugas (PCL/PML/PCS/pengawas/pencacah), kode identitas, wilayah, status, foto selain KTP, x/y subsegmen.
Penanda `""`, `-`, `#N/A`, `#REF!`, `()` dibiarkan apa adanya.

## GET /api/monitoring/ringkasan

Satu tab: `?id=<id>`. Semua TP: `?bidang=tp[&arsip=1]` (default bidang `tp`).

```json
{
  "id": "tp-1IzurELQ-0", "label": "Monitoring KSA Padi (Amatan November)", "survei": "KSA 2026 Amatan November",
  "total": 5, "sudah": 2, "belum": 3, "persen": 40,
  "definisi": {
    "teks": "Sudah bila kolom \"Sudah Kirim Foto\" bernilai \"Sudah Kirim Foto\" (tanpa beda huruf besar/kecil).",
    "kolomKunci": "ID Sub Segmen", "kolomStatus": "Sudah Kirim Foto", "aturan": "sama",
    "nilai": ["Sudah Kirim Foto"], "catatan": "…", "ragu": false
  },
  "rincian": [{ "nilai": "Sudah Kirim Foto", "jumlah": 2 }, { "nilai": "(kosong)", "jumlah": 1 }],
  "perPml": [{ "pml": "Pengawas A", "total": 2, "sudah": 2, "belum": 0, "persen": 100 }],
  "perPcl": [{ "pcl": "Petugas A", "total": 2, "sudah": 2, "belum": 0, "persen": 100 }],
  "perKecamatan": [{ "kecamatan": "Kec Satu", "total": 2, "sudah": 2, "belum": 0, "persen": 100 }],
  "meta": { "syncedAt": "…", "changedAt": "…", "stale": false, "headerRow": 2 }
}
```

`perKecamatan` bisa `null` (sheet tanpa kolom kecamatan). `definisi.ragu=true` = definisi perlu dikonfirmasi pemilik data; tampilkan `catatan`.

Batch `?bidang=tp`:

```json
{
  "bidang": "tp",
  "data": [
    { "id": "…", "label": "…", "survei": "…", "status": "ok", "total": 1143, "sudah": 514, "…": "…" },
    { "id": "…", "label": "…", "survei": "…", "status": "ditunda", "error": { "code": "BATAS_PERMINTAAN", "message": "…" }, "cobaLagiDetik": 60 },
    { "id": "…", "label": "…", "survei": "…", "status": "galat", "error": { "code": "SOURCE_UNAVAILABLE", "message": "…" } }
  ],
  "tanpaRingkasan": [{ "id": "…", "label": "…", "alasan": "SHEET_FORMAT_UNSUPPORTED" }],
  "meta": { "total": 12, "ok": 12, "ditunda": 0, "galat": 0, "diambilDariGoogle": 3, "batasAmbil": 10, "arsipDitampilkan": false }
}
```

Batch mengambil maksimal 10 tab dari Google per permintaan (jatah subrequest Workers). Sisanya `ditunda` bila belum ada cache. Item `ditunda` membawa `cobaLagiDetik` (saat ini 60) sebagai jeda yang disarankan sebelum memuat ulang; respons batch tetap HTTP 200 jadi tidak ada header `Retry-After` (header itu hanya pada galat tunggal `BATAS_PERMINTAAN` / `SOURCE_UNAVAILABLE`).
Alasan `tanpaRingkasan`: `SHEET_FORMAT_UNSUPPORTED`, `SHEET_REMOVED`, `ARSIP_BELUM_DIPETAKAN`, `BELUM_DIPETAKAN`.

## Kode galat

| Kode | HTTP | Kapan | retryable | Google dipanggil? |
|---|---|---|---|---|
| `VALIDATION` | 400 | parameter salah/kurang | false | tidak |
| `FORBIDDEN` | 403 | mitra | false | tidak |
| `NOT_FOUND` | 404 | tab tidak ada di katalog | false | tidak |
| `SHEET_FORMAT_UNSUPPORTED` | 422 | tab dilewati katalog: file .xlsx | false | tidak |
| `SHEET_REMOVED` | 410 | tab dilewati (dihapus), atau Google 404/410 | false | tidak untuk yang dilewati |
| `SHEET_NOT_PUBLIC` | 403 | sheet tidak publik (diarahkan ke login / balasan HTML) | false | ya |
| `SHEET_EXPORT_REJECTED` | 502 | Google 400 untuk tab di luar daftar lewati | false | ya |
| `SHEET_TOO_LARGE` | 502 | CSV > 8 MB | false | ya |
| `SOURCE_UNAVAILABLE` | 503 | jaringan/timeout 15 dtk/429/5xx dan TIDAK ada salinan | true (`Retry-After: 60`) | ya |
| `RINGKASAN_BELUM_DIPETAKAN` | 422 | ringkasan untuk tab tanpa peta (arsip TP, INPEK, HORTI) | false | tidak |
| `RINGKASAN_KOLOM_HILANG` | 422 | kolom yang dipetakan tidak ada di sheet; `fields.kolom` | false | ya |

Bila Google gagal tetapi ada salinan terakhir: 200 dengan `meta.stale=true` dan `meta.error`.

Contoh:

```json
{ "error": { "code": "SHEET_FORMAT_UNSUPPORTED", "message": "Google menolak ekspor CSV untuk tab ini (HTTP 400). File sumber berformat .xlsx …", "retryable": false, "sumber": { "id": "tp-1PFzZu6n-1040754140", "label": "Monitoring Ubinan Padi SR 2 2026" } } }
```

## Saran UI (bukan bagian kontrak)

- Pakai `/api/monitoring/katalog`, kelompokkan per `survei`, tombol "Tampilkan arsip" -> `arsip=1`.
- Tab `tersedia:false`: tampilkan kartu abu-abu + `alasan.pesan`, jangan panggil `/tab`.
- Tampilkan `tautan` sebagai tombol; `perluCek:true` beri tanda peringatan.
- Untuk PML tampilkan label "Data disamarkan" bila `meta.disamarkan`.
- Menu Monitoring untuk PML belum dibuka di frontend (keputusan UI di GIBRAN).

## Kompatibilitas frontend ca22f02

- `/api/gsheets` tetap `{sheets:[{bidang,survei,label,sid,gid,…}]}`, kini default tanpa arsip (43 tab), `?arsip=1` untuk 70.
- `/api/gsheet` tetap punya `rows` + `meta.syncedAt/stale`. Tab yang dilewati kini membalas 422/410 dengan pesan jujur (frontend lama menampilkannya lewat `errBlock`).
- Nama `survei` sekarang hasil kurasi (bukan judul halaman Sites), jadi pengelompokan berubah.
