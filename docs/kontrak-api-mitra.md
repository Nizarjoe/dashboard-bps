# Kontrak API v1 Admin/Mitra/PML (dashboard-bps Kebumen)

Arsitektur:
- Hosting tetap Pages Functions. Sesi tetap di KV SESSIONS (Bearer, TTL 7 hari). D1 tidak dipakai lagi untuk data sampel.
- Baca sheet asli lewat CSV publik `https://docs.google.com/spreadsheets/d/<ID>/export?format=csv`. Cache KV 3 menit plus salinan terakhir yang berhasil dibaca. Kalau sumber gagal, pakai salinan itu dan kirim `meta.stale=true`. Kalau belum ada salinan, balas 503 SOURCE_UNAVAILABLE.
- Pengeringan `1GlyJLe84fw2yRpZ4li46URdumwXpPLCM`: header di baris ke-3, kunci `idsubsegmen`. Kolom: No., kdprov, nmprov, kdkab, nmkab, kdkec, nmkec, lokasi, idsubsegmen, nks, fase_ amatan, x, y, bulan_panen, flag_ sampel (U/C), PCL, PML, Lokasi IDSegmen, Lokasi IDSegmen_KASebelum, Lokasi IDSegmen_KASetelah, Lokasi IDSegmen_KTP, Status Sampel, Foto Kadar Air Sebelum Pengeringan Amatan ke 1..5, Foto Kadar Air Setelah Pengeringan Amatan ke 1..5, NAMA RESPONDEN, NIK, Foto KTP Responden, Foto Penyerahan Biaya Penggantian Sampel.
- Penggilingan `1xGc6KE53mbz0U-UaP82W8kNVT9n4aQxO`: header di baris ke-3, kunci `ID SBR`. Kolom: No., Kode Provinsi, Nama Provinsi, Kode Kabupaten /Kota, Nama Kabupaten /Kota, Kode Kecamatan, Nama Kecamatan, Kode Desa/ Kelurahan, Nama Desa/ Kelurahan, ID SBR, NKS, Nama Usaha/Perusahaan, Nama Narahubung, Nomor Telepon, Alamat Usaha, Longitude, Latitude, Skala Usaha/Perusahaan, Jenis Sampel (U/C), Hasil Pencacahan, PCL, PML, lalu 3 kolom tanpa header, Foto KA Sebelum Penggilingan 1..5, Setelah 1..5, NAMA RESPONDEN, NIK, Foto KTP Responden, Foto Penyerahan Biaya Penggantian Sampel. Header kosong dan spasi ganda harus ditangani; cocokkan header secara toleran.
- Penulisan lewat adapter `WriteStore`:
  - (a) `AppsScriptStore`: POST ke `env.APPS_SCRIPT_URL` dengan body JSON bertanda tangan HMAC-SHA256 dari `env.APPS_SCRIPT_SECRET`, plus timestamp dan nonce untuk mencegah replay. Operasi: appendIsian, listIsian, uploadFoto (base64), getFoto, listAkun, upsertAkun.
  - (b) `MemoryStore` atau `KvStore` untuk tes dan untuk preview sebelum akun Google siap. Dipilih otomatis bila APPS_SCRIPT_URL kosong.
  - Tulis juga sumber Apps Script-nya di `apps-script/Code.gs` plus README langkah deploy (Execute as: Me, akses Anyone). Skrip memverifikasi HMAC, menulis ke sheet 'Input Mitra SKGB 3305' (tab `isian` dan `akun`), dan menyimpan foto di Drive `SKGB 2026/<jenis>/<id>/` sebagai file privat.
  - Alasan memakai Apps Script: service account tidak punya kuota Drive di Gmail biasa.
- Input Mitra append-only: setiap baris berisi key, versi, oleh, aksi, waktu, dan isian. Versi terbaru yang berlaku.
- Akun:
  - Tab `akun` berisi kolom id, nama, peran, pml_id, aktif.
  - Seed: nama PCL/PML dari kedua sheet di-trim, spasi ganda dipadatkan, lalu di-uppercase ('FENDY HERMAWAN ' sama dengan 'FENDY HERMAWAN'). Urutkan alfabetis, lalu beri ID mitra `3305001`… dan PML `3305P01`….
  - Nama baru ditambahkan di akhir, ID lama tidak bergeser.
  - Relasi mitra ke PML diambil dari pasangan PCL-PML di sheet. Kalau satu mitra punya beberapa PML, simpan semuanya; PML melihat sampel di mana dia tercatat sebagai PML.
  - Admin `3305`.
  - Hapus superadmin, admin provinsi, dan 34 kabupaten lain.

Konvensi:
- JSON. Semua endpoint selain login butuh Bearer.
- Daftar berbentuk `{data:[...], meta:{syncedAt, stale}}`.
- Error berbentuk `{error:{code,message,fields?}}`, message dalam Bahasa Indonesia.
- Kode error: 400 BAD_REQUEST, 401 UNAUTHENTICATED, 401 INVALID_CREDENTIALS, 403 FORBIDDEN, 404 NOT_FOUND, 409 LOCKED, 409 CONFLICT (versi usang), 413 FILE_TOO_LARGE (>2MB), 415 UNSUPPORTED_FILE (bukan jpeg/png/webp), 422 VALIDATION, 429 RATE_LIMITED (+Retry-After), 502 UPSTREAM_ERROR, 503 SOURCE_UNAVAILABLE.
- role: admin, mitra, atau pml. jenis: pengeringan atau penggilingan. id = idsubsegmen atau ID SBR. status: belum, draf, sudah (terkunci untuk mitra), atau ditolak (kunci dibuka, ada alasan).
- Slot (12, urutan tetap): ka_sebelum_1..5, ka_setelah_1..5, ktp, penyerahan. Label diambil dari header.
- NIK untuk PML ditampilkan tersamar, 4 digit awal dan 4 digit akhir: `3305********0001`. Foto ktp untuk PML: url null, hidden:true, dan GET foto membalas 403. Narahubung dan telepon tidak dikirim ke PML.

Tipe:
- `User {id,nama,role}`
- `Orang {id,nama}`
- `Foto {slot,label,terisi,url|null,hidden?,uploadedAt|null}`
- `SampelRingkas {jenis,id,kecamatan,desa,nama|null (penggilingan: Nama Usaha),nks,flagSampel:'U'|'C',mitra:Orang,pml:Orang,status,fotoTerisi,fotoTotal:12,dikirimAt|null,updatedAt|null}`
- `Anomali {jenis,id,mitra:Orang,kode:'NIK_TIDAK_VALID'|'FOTO_KURANG'|'KTP_KOSONG'|'STATUS_KOSONG'|'DIKIRIM_TANPA_FOTO_KA',pesan}`

Endpoint:
- `POST /api/login {id,password}` membalas 200 `{token,expiresAt,user}`. Error: 400, 401 INVALID_CREDENTIALS (pesan sama untuk ID tak dikenal dan password salah), 429 setelah 5 gagal per ID per 10 menit.
- `POST /api/logout` selalu membalas 200 `{ok:true}`.
- `GET /api/me` membalas `{user,syncedAt}`; mitra mendapat tambahan `pml:Orang`, PML mendapat tambahan `jumlahMitra`.
- `GET /api/sampel?jenis=&status=&mitra=`: admin melihat semua, mitra hanya miliknya (parameter mitra diabaikan), PML hanya bawahannya. Respons `{data:SampelRingkas[], meta:{syncedAt,stale,progres:{total,sudah,draf,ditolak,belum}}}`.
- `GET /api/sampel/:jenis/:id` membalas `{sampel, sumber:{faseAmatan,bulanPanen,x,y,lokasiIdSegmen,skalaUsaha,narahubung,telepon,alamat}, isian:{namaResponden,nik,statusSampel (pengeringan) | hasilPencacahan (penggilingan), null bila tidak berlaku}, foto:Foto[12], locked, versi, alasanDitolak, riwayat (hanya admin):[{versi,oleh:Orang,aksi,waktu}]}`. Isian diambil dari Input Mitra terbaru, kalau belum ada dari sheet asli. Error: 403, 404.
- `PUT /api/sampel/:jenis/:id/isian {versi,kirim,isian}`:
  - Mitra hanya untuk sampel miliknya dan saat belum terkunci. Admin kapan saja; untuk admin `kirim` opsional dan status dipertahankan.
  - `kirim:false` menghasilkan status draf. `kirim:true` menghasilkan status sudah dan mengunci; syaratnya NIK `^\d{16}$` dan foto ktp sudah ada.
  - statusSampel atau hasilPencacahan harus ada di /api/opsi. namaResponden 1-100 karakter.
  - Versi tidak cocok menghasilkan 409 CONFLICT.
  - Respons 200 `{status,versi,locked,updatedAt}`. Error: 403, 404, 409 LOCKED/CONFLICT, 422, 502.
- `PUT /api/sampel/:jenis/:id/foto/:slot` (multipart, field file, maksimal 2MB, jpeg/png/webp; hak akses sama dengan isian). Foto lama di slot itu diganti, tetapi tetap disimpan sebagai riwayat. Respons 200 `{slot,terisi,url:'/api/foto/<jenis>/<id>/<slot>',uploadedAt,fotoTerisi}`.
- `GET /api/foto/:jenis/:id/:slot` mengembalikan byte gambar dengan `Cache-Control: private, max-age=300`. Hak akses sama dengan detail; PML yang meminta ktp mendapat 403; slot kosong mendapat 404.
- `GET /api/opsi` membalas `{statusSampel:[], hasilPencacahan:[], slots:[{slot,label:{pengeringan,penggilingan}}]}`. Nilai opsi = nilai unik dari sheet ditambah daftar tetap.
- `GET /api/admin/dashboard` membalas `{kpi:{pengeringan:{sampel,utama,cadangan,sudah,draf,ditolak,belum,fotoLengkap}, penggilingan:{...}}, perMitra:[{mitra,pml,total,sudah,draf,ditolak,belum}], perKecamatan:[{kdkec,nmkec,total,sudah}], anomali:Anomali[], syncedAt, stale}`.
- `POST /api/admin/sampel/:jenis/:id/tolak {alasan 1-300}` membalas `{status:'ditolak',versi,locked:false}`.
- `GET /api/admin/akun` membalas `{data:[{id,nama,role,pml:Orang|null,aktif,jumlahSampel}]}` tanpa password.
- `GET /api/admin/ekspor?jenis=&format=csv` mengembalikan CSV gabungan sheet asli dan isian terbaru.
- `GET /api/gsheets` hanya admin (mitra dan PML 403 FORBIDDEN). Membalas `{sheets:[{bidang:'tp'|'inpek'|'horti', survei, label, sid, gid}]}` dari `data/gsheets.json`.
- `GET /api/gsheet?sid=&gid=` hanya admin. `rows` memakai `parseCsv` lama (baris kosong dibuang, kolom kosong di kanan dipotong). Respons `{rows:string[][], meta:{syncedAt, stale}}`. Hanya pasangan sid+gid yang ada di katalog; selain itu 404 NOT_FOUND. Cache KV 5 menit plus salinan terakhir (`stale:true`). Tanpa salinan: 503 SOURCE_UNAVAILABLE.
- `GET /api/pml/dashboard` membalas `{pml, mitra:[{mitra,total,sudah,draf,ditolak,belum,fotoLengkap}], anomali, syncedAt, stale}`. Semua PUT/POST dari PML dibalas 403.
- Endpoint lama dari PR #2 (`/api/sheet/*`, `/api/realisasi`, peta provinsi, KSA, `/api/monitoring-gc`, upload KV) DIHAPUS. `/api/monitoring-gc` tidak dikembalikan.
